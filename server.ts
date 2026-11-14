import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  attachWebSocketServer,
  createLivecastApp,
  seedInitialSampleVideo,
} from './backend/src/app.ts';
import { streamManager } from './backend/src/ffmpeg.ts';

const PORT = Number(process.env.PORT) || 3000;

async function bootstrap(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');
  const hasBuiltDist = fs.existsSync(path.join(distDir, 'index.html'));

  const app = createLivecastApp({ standaloneBackend: isProd && !hasBuiltDist });
  await seedInitialSampleVideo();

  const server = http.createServer(app);
  attachWebSocketServer(server);

  if (!isProd) {
    app.get('/dev-sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(`
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});
`);
    });

    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: true,
        ws: { server },
        watch: hmrDisabled ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (hasBuiltDist) {
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.apk')) {
            res.setHeader('Content-Type', 'application/vnd.android.package-archive');
            res.setHeader('Content-Disposition', 'attachment; filename="livecast-companion.apk"');
          }
        },
      }),
    );
    app.get('*', (req, res) => {
      if (req.path.startsWith('/downloads/')) {
        res.status(404).json({ error: 'Android APK not published yet.' });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LIVECAST STUDIO server listening on http://0.0.0.0:${PORT}`);
  });

  const gracefulShutdown = async () => {
    await streamManager.stopStream();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap LIVECAST STUDIO:', err);
  process.exit(1);
});
