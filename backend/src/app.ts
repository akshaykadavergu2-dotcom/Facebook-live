import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import multer from 'multer';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  OverlayConfig,
  StreamQualityProfile,
  VideoAsset,
  VideoSourceType,
} from '../shared/types.ts';
import {
  clearSessionCookie,
  isAuthEnabled,
  isRequestAuthenticated,
  parseCookies,
  requireStudioAuth,
  setSessionCookie,
  verifyOperatorPassword,
  verifySessionToken,
} from './auth.ts';
import { isEnvEncryptionKeySet } from './crypto.ts';
import {
  checkFfmpegAvailability,
  generateSampleVideo,
  probeMedia,
  streamManager,
  validateDirectMediaUrl,
  validateRtmpUrl,
} from './ffmpeg.ts';
import {
  addVideo,
  clearStreamHistory,
  clearStreamKey,
  ensureDirectories,
  getDecryptedStreamKey,
  getOverlayConfig,
  getRtmpPublicConfig,
  getStreamHistory,
  getVideoById,
  getVideos,
  OVERLAYS_DIR,
  removeVideo,
  safeResolveVideoPath,
  saveOverlayConfig,
  saveRtmpConfig,
  VIDEOS_DIR,
} from './storage.ts';
import { validateYouTubeUrl } from './youtube.ts';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://streamkarolive.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  const rawList = [
    process.env.ALLOWED_CORS_ORIGIN || '',
    process.env.FRONTEND_ORIGIN || '',
    process.env.APP_URL || '',
  ]
    .join(',')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  for (const origin of rawList) {
    allowed.add(origin);
  }
  return allowed;
}

function isOriginAllowed(
  origin: string | undefined,
  hostHeader: string | undefined,
  forwardedHostHeader?: string | string[],
): boolean {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, '');
  const allowed = getAllowedOrigins();
  if (allowed.has('*') || allowed.has(normalized)) {
    return true;
  }
  if (/^https:\/\/[a-z0-9-]+--streamkarolive\.netlify\.app$/i.test(normalized)) {
    return true;
  }
  const hosts = [
    hostHeader,
    Array.isArray(forwardedHostHeader) ? forwardedHostHeader[0] : forwardedHostHeader,
  ].filter(Boolean) as string[];

  for (const h of hosts) {
    const cleanHost = h.split(',')[0].trim();
    if (normalized === `https://${cleanHost}` || normalized === `http://${cleanHost}`) {
      return true;
    }
  }
  return false;
}

function isValidPngSignature(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return buf.equals(pngHeader);
  } catch {
    return false;
  }
}

export async function seedInitialSampleVideo(): Promise<void> {
  if (getVideos().length > 0) return;
  const ff = await checkFfmpegAvailability();
  if (!ff.available) return;

  const sampleFile = 'sample_smpte_broadcast.mp4';
  const samplePath = path.join(VIDEOS_DIR, sampleFile);
  try {
    await generateSampleVideo(samplePath);
    const stat = fs.statSync(samplePath);
    const probe = await probeMedia(samplePath);
    addVideo({
      id: 'vid_default_sample',
      originalName: 'SMPTE Test Broadcast (12s 720p30).mp4',
      filename: sampleFile,
      sizeBytes: stat.size,
      mimeType: 'video/mp4',
      url: `/media/videos/${encodeURIComponent(sampleFile)}`,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      hasAudio: probe.hasAudio,
      uploadedAt: new Date().toISOString(),
      isSample: true,
    });
  } catch (err) {
    console.warn('Skipping initial sample video generation:', err);
  }
}

export interface CreateAppOptions {
  standaloneBackend?: boolean;
}

export function createLivecastApp(options: CreateAppOptions = {}): express.Express {
  const MAX_UPLOAD_MB = Math.min(2048, Math.max(25, Number(process.env.MAX_UPLOAD_MB) || 500));

  ensureDirectories();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Strict CORS + security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin, req.headers.host, req.headers['x-forwarded-host'])) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  // Handle malformed JSON payloads cleanly as JSON 400
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Invalid JSON request payload.' });
      return;
    }
    next(err);
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and retry.' },
  });

  const streamControlLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Stream control rate limit exceeded. Wait before retrying.' },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
  });

  app.use('/api', apiLimiter);

  // Allow cross-origin video/image preview from Netlify frontend
  app.use(
    '/media/videos',
    requireStudioAuth,
    express.static(VIDEOS_DIR, {
      acceptRanges: true,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  app.use(
    '/media/overlays',
    requireStudioAuth,
    express.static(OVERLAYS_DIR, {
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  const ALLOWED_VIDEO_MIMES = new Set([
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    'application/octet-stream',
  ]);
  const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv']);

  const videoUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, VIDEOS_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ALLOWED_VIDEO_EXTS.has(ext) ? ext : '.mp4';
        cb(null, `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
      },
    }),
    limits: {
      fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_VIDEO_EXTS.has(ext) || !ALLOWED_VIDEO_MIMES.has(file.mimetype)) {
        cb(new Error('Unsupported video format. Allowed formats: MP4, MOV, WebM, MKV.'));
        return;
      }
      cb(null, true);
    },
  });

  const logoUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, OVERLAYS_DIR),
      filename: (_req, _file, cb) => {
        cb(null, `logo_${Date.now()}.png`);
      },
    }),
    limits: {
      fileSize: 8 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (file.mimetype !== 'image/png' || ext !== '.png') {
        cb(new Error('Logo overlay must be a transparent PNG (.png) file.'));
        return;
      }
      cb(null, true);
    },
  });

  // Health endpoint
  app.get('/api/health', async (_req, res) => {
    const ff = await checkFfmpegAvailability();
    res.json({
      ok: true,
      service: 'livecast-studio-backend',
      ffmpegAvailable: ff.available,
      ffmpegVersion: ff.version,
      status: streamManager.getTelemetry().status,
      timestamp: new Date().toISOString(),
    });
  });

  // Auth endpoints
  app.get('/api/auth/status', async (req, res) => {
    const ff = await checkFfmpegAvailability();
    res.json({
      authRequired: isAuthEnabled(),
      authenticated: isRequestAuthenticated(req),
      encryptionConfigured: isEnvEncryptionKeySet(),
      rateLimitEnabled: true,
      ffmpegAvailable: ff.available,
      ffmpegVersion: ff.version,
      maxUploadMb: MAX_UPLOAD_MB,
    });
  });

  app.post('/api/auth/login', authLimiter, (req, res) => {
    if (!isAuthEnabled()) {
      res.json({ authenticated: true, authRequired: false });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyOperatorPassword(password)) {
      res.status(401).json({ error: 'Invalid studio operator password.' });
      return;
    }
    setSessionCookie(res, req);
    res.json({ authenticated: true, authRequired: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res, req);
    res.json({ authenticated: false });
  });

  // Stream status & controls
  app.get('/api/stream/status', requireStudioAuth, (_req, res) => {
    res.json({
      telemetry: streamManager.getTelemetry(),
      logs: streamManager.getLogs(),
    });
  });

  app.post('/api/stream/start', requireStudioAuth, streamControlLimiter, async (req, res) => {
    if (streamManager.isBusy()) {
      res.status(409).json({
        error: 'A live stream is already connecting or active. Stop the current stream before starting another.',
      });
      return;
    }

    const body = (req.body ?? {}) as {
      sourceType?: VideoSourceType;
      videoId?: string;
      directUrl?: string;
      quality?: StreamQualityProfile;
      loopVideo?: boolean;
    };

    if (body.sourceType === 'youtube-preview') {
      res.status(400).json({
        error:
          'YouTube share URLs are preview-only via the official YouTube IFrame Player API and cannot be captured by FFmpeg. Upload an MP4/MOV/WebM file or provide an authorized direct media URL to broadcast.',
      });
      return;
    }

    const quality: StreamQualityProfile = body.quality === '1080p' ? '1080p' : '720p';
    const loopVideo = Boolean(body.loopVideo);

    const rtmpConfig = getRtmpPublicConfig();
    const streamKey = getDecryptedStreamKey();

    const rtmpValidation = validateRtmpUrl(rtmpConfig.serverUrl);
    if (!rtmpValidation.valid || !rtmpValidation.normalized) {
      res.status(400).json({ error: rtmpValidation.error || 'Invalid Facebook RTMP Server URL.' });
      return;
    }
    if (!streamKey) {
      res.status(400).json({
        error: 'Facebook RTMP Stream Key is not configured. Save your Stream Key securely on the server first.',
      });
      return;
    }

    let inputTarget = '';
    let isLocalFile = false;
    let sourceType: VideoSourceType = 'uploaded';
    let sourceLabel = '';

    if (body.sourceType === 'direct-url') {
      const check = validateDirectMediaUrl(body.directUrl || '');
      if (!check.valid || !check.normalized) {
        res.status(400).json({ error: check.error || 'Invalid direct media URL.' });
        return;
      }
      inputTarget = check.normalized;
      isLocalFile = false;
      sourceType = 'direct-url';
      sourceLabel = check.normalized;
    } else {
      if (!body.videoId) {
        res.status(400).json({ error: 'Select an uploaded video source or enter a direct media URL.' });
        return;
      }
      const asset = getVideoById(body.videoId);
      if (!asset) {
        res.status(404).json({ error: 'Selected video file was not found on the server.' });
        return;
      }
      const safePath = safeResolveVideoPath(asset.filename);
      if (!safePath || !fs.existsSync(safePath)) {
        res.status(404).json({ error: 'Video file missing on disk.' });
        return;
      }
      inputTarget = safePath;
      isLocalFile = true;
      sourceType = 'uploaded';
      sourceLabel = asset.originalName;
    }

    try {
      const telemetry = await streamManager.startStream({
        inputTarget,
        isLocalFile,
        sourceType,
        sourceLabel,
        quality,
        rtmpServerUrl: rtmpValidation.normalized,
        streamKey,
        overlays: getOverlayConfig(),
        loopVideo,
      });
      res.json({ telemetry });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start FFmpeg stream.';
      if (message === 'STREAM_ALREADY_ACTIVE') {
        res.status(409).json({ error: 'A broadcast session is already active.' });
        return;
      }
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/stream/stop', requireStudioAuth, streamControlLimiter, async (_req, res) => {
    const telemetry = await streamManager.stopStream();
    res.json({ telemetry });
  });

  app.post('/api/stream/validate-pipeline', requireStudioAuth, streamControlLimiter, async (req, res) => {
    const body = (req.body ?? {}) as {
      sourceType?: VideoSourceType;
      videoId?: string;
      directUrl?: string;
      quality?: StreamQualityProfile;
    };

    if (body.sourceType === 'youtube-preview') {
      res.status(400).json({
        error: 'YouTube links are preview-only and cannot be encoded by FFmpeg.',
      });
      return;
    }

    let inputTarget = '';
    if (body.sourceType === 'direct-url') {
      const check = validateDirectMediaUrl(body.directUrl || '');
      if (!check.valid || !check.normalized) {
        res.status(400).json({ error: check.error || 'Invalid direct media URL.' });
        return;
      }
      inputTarget = check.normalized;
    } else {
      const asset = body.videoId ? getVideoById(body.videoId) : undefined;
      if (!asset) {
        res.status(404).json({ error: 'Select a valid uploaded video file first.' });
        return;
      }
      const safePath = safeResolveVideoPath(asset.filename);
      if (!safePath || !fs.existsSync(safePath)) {
        res.status(404).json({ error: 'Video file missing on disk.' });
        return;
      }
      inputTarget = safePath;
    }

    const quality: StreamQualityProfile = body.quality === '1080p' ? '1080p' : '720p';
    try {
      const result = await streamManager.testPipelineDryRun(inputTarget, quality, getOverlayConfig());
      res.json(result);
    } catch (err) {
      res.status(400).json({
        success: false,
        message: err instanceof Error ? err.message : 'Dry-run encode failed.',
      });
    }
  });

  // Encrypted Facebook RTMP credentials endpoints
  // Supports both /api/stream/credentials and /api/rtmp/config aliases
  const handleGetCredentials = (_req: Request, res: Response) => {
    res.json(getRtmpPublicConfig());
  };

  const handleSaveCredentials = (req: Request, res: Response) => {
    const serverUrl = typeof req.body?.serverUrl === 'string' ? req.body.serverUrl : '';
    const streamKey = typeof req.body?.streamKey === 'string' ? req.body.streamKey : undefined;

    const check = validateRtmpUrl(serverUrl);
    if (!check.valid || !check.normalized) {
      res.status(400).json({ error: check.error || 'Invalid RTMP server URL.' });
      return;
    }

    if (streamKey !== undefined && streamKey.trim().length > 0 && /[\s\r\n\0]/.test(streamKey.trim())) {
      res.status(400).json({ error: 'Stream Key contains invalid whitespace or control characters.' });
      return;
    }

    const updated = saveRtmpConfig(
      check.normalized,
      streamKey && streamKey.trim().length > 0 ? streamKey : undefined,
    );
    res.json(updated);
  };

  const handleDeleteCredentials = (_req: Request, res: Response) => {
    res.json(clearStreamKey());
  };

  app.get('/api/stream/credentials', requireStudioAuth, handleGetCredentials);
  app.post('/api/stream/credentials', requireStudioAuth, handleSaveCredentials);
  app.delete('/api/stream/credentials', requireStudioAuth, handleDeleteCredentials);

  app.get('/api/rtmp/config', requireStudioAuth, handleGetCredentials);
  app.post('/api/rtmp/config', requireStudioAuth, handleSaveCredentials);
  app.delete('/api/rtmp/key', requireStudioAuth, handleDeleteCredentials);

  // Videos & URL validation
  app.get('/api/videos', requireStudioAuth, (_req, res) => {
    res.json({ videos: getVideos() });
  });

  app.post('/api/video/upload', requireStudioAuth, (req, res) => {
    videoUpload.single('video')(req, res, async (uploadErr: unknown) => {
      if (uploadErr) {
        const msg = uploadErr instanceof Error ? uploadErr.message : 'Video upload failed.';
        res.status(400).json({ error: msg });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No video file received.' });
        return;
      }

      try {
        const probe = await probeMedia(req.file.path);
        const asset: VideoAsset = {
          id: `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          originalName: req.file.originalname,
          filename: req.file.filename,
          sizeBytes: req.file.size,
          mimeType: req.file.mimetype,
          url: `/media/videos/${encodeURIComponent(req.file.filename)}`,
          durationSec: probe.durationSec,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          videoCodec: probe.videoCodec,
          audioCodec: probe.audioCodec,
          hasAudio: probe.hasAudio,
          uploadedAt: new Date().toISOString(),
        };
        const videos = addVideo(asset);
        res.status(201).json({ video: asset, videos });
      } catch (err) {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res.status(400).json({
          error: `Uploaded file is not a valid video stream: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });
  });

  app.post('/api/videos/generate-sample', requireStudioAuth, async (_req, res) => {
    try {
      const filename = `sample_broadcast_${Date.now()}.mp4`;
      const targetPath = path.join(VIDEOS_DIR, filename);
      await generateSampleVideo(targetPath);
      const stat = fs.statSync(targetPath);
      const probe = await probeMedia(targetPath);
      const asset: VideoAsset = {
        id: `vid_sample_${Date.now()}`,
        originalName: 'SMPTE Test Broadcast (12s 720p30).mp4',
        filename,
        sizeBytes: stat.size,
        mimeType: 'video/mp4',
        url: `/media/videos/${encodeURIComponent(filename)}`,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        hasAudio: probe.hasAudio,
        uploadedAt: new Date().toISOString(),
        isSample: true,
      };
      const videos = addVideo(asset);
      res.status(201).json({ video: asset, videos });
    } catch (err) {
      res.status(500).json({
        error: `Failed to generate sample MP4: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.delete('/api/videos/:id', requireStudioAuth, (req, res) => {
    const id = String(req.params.id);
    const removed = removeVideo(id);
    if (!removed) {
      res.status(404).json({ error: 'Video asset not found.' });
      return;
    }
    res.json({ videos: getVideos() });
  });

  app.post('/api/videos/validate-youtube', requireStudioAuth, async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    const result = await validateYouTubeUrl(url);
    if (!result.valid) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  app.post('/api/videos/validate-direct-url', requireStudioAuth, async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    const check = validateDirectMediaUrl(url);
    if (!check.valid || !check.normalized) {
      res.status(400).json({ valid: false, error: check.error });
      return;
    }
    try {
      const probe = await probeMedia(check.normalized);
      res.json({
        valid: true,
        url: check.normalized,
        probe,
      });
    } catch (err) {
      res.status(400).json({
        valid: false,
        error: `Unable to probe direct media URL: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Overlays
  app.get('/api/overlays', requireStudioAuth, (_req, res) => {
    res.json(getOverlayConfig());
  });

  app.post('/api/overlays', requireStudioAuth, (req, res) => {
    const incoming = (req.body ?? {}) as Partial<OverlayConfig>;
    const { logoPath: _ignoredPath, logoUrl: _ignoredUrl, ...safeFields } = incoming;
    const updated = saveOverlayConfig(safeFields);
    res.json(updated);
  });

  app.post('/api/overlays/logo', requireStudioAuth, (req, res) => {
    logoUpload.single('logo')(req, res, (uploadErr: unknown) => {
      if (uploadErr) {
        res.status(400).json({ error: uploadErr instanceof Error ? uploadErr.message : 'Logo upload failed.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No PNG logo file uploaded.' });
        return;
      }
      if (!isValidPngSignature(req.file.path)) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ error: 'File signature check failed. Upload a valid PNG image.' });
        return;
      }

      const current = getOverlayConfig();
      if (current.logoPath && fs.existsSync(current.logoPath)) {
        try {
          fs.unlinkSync(current.logoPath);
        } catch {
          // ignore
        }
      }

      const updated = saveOverlayConfig({
        logoEnabled: true,
        logoPath: req.file.path,
        logoUrl: `/media/overlays/${encodeURIComponent(req.file.filename)}`,
      });
      res.status(201).json(updated);
    });
  });

  app.delete('/api/overlays/logo', requireStudioAuth, (_req, res) => {
    const current = getOverlayConfig();
    if (current.logoPath && fs.existsSync(current.logoPath)) {
      try {
        fs.unlinkSync(current.logoPath);
      } catch {
        // ignore
      }
    }
    const updated = saveOverlayConfig({
      logoEnabled: false,
      logoPath: null,
      logoUrl: null,
    });
    res.json(updated);
  });

  // History
  app.get('/api/history', requireStudioAuth, (_req, res) => {
    res.json({ history: getStreamHistory() });
  });

  app.delete('/api/history', requireStudioAuth, (_req, res) => {
    clearStreamHistory();
    res.json({ history: [] });
  });

  // Explicit 404 JSON response for any missing /api/* endpoint
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  // JSON error handler for /api
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  if (options.standaloneBackend) {
    app.get('/', (_req, res) => {
      res.json({
        ok: true,
        service: 'LIVECAST STUDIO Backend API',
        health: '/api/health',
        websocket: '/ws',
      });
    });

    app.use((req, res) => {
      res.status(404).json({
        error: `Route not found: ${req.method} ${req.originalUrl}`,
      });
    });
  }

  return app;
}

export function attachWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const aliveClients = new WeakSet<WebSocket>();

  // Heartbeat keeps WebSocket alive across Render/Nginx/Cloudflare proxy idle timeouts
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (!aliveClients.has(client)) {
        client.terminate();
        continue;
      }
      aliveClients.delete(client);
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (reqUrl.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!isOriginAllowed(request.headers.origin, request.headers.host, request.headers['x-forwarded-host'])) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    if (isAuthEnabled()) {
      const cookies = parseCookies(request.headers.cookie);
      if (!verifySessionToken(cookies['livecast_session'])) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  function broadcastWs(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  wss.on('connection', (ws) => {
    aliveClients.add(ws);
    ws.on('pong', () => {
      aliveClients.add(ws);
    });

    ws.send(
      JSON.stringify({
        type: 'init',
        telemetry: streamManager.getTelemetry(),
        logs: streamManager.getLogs(),
        history: getStreamHistory(),
      }),
    );
  });

  streamManager.on('status', (telemetry) => {
    broadcastWs({ type: 'status', telemetry });
  });
  streamManager.on('log', (entry) => {
    broadcastWs({ type: 'log', entry });
  });
  streamManager.on('history', (entry) => {
    broadcastWs({ type: 'history', entry });
  });

  return wss;
}
