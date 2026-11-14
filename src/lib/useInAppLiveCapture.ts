import { useCallback, useEffect, useRef, useState } from 'react';
import type { AndroidCaptureSessionInfo, AndroidCaptureTelemetry } from '../../shared/types';
import { api, getWebIngestUrl } from './api';

export type InAppCaptureMode = 'screen' | 'camera';

export interface UseInAppLiveCaptureOptions {
  onTelemetryUpdated: (next: AndroidCaptureTelemetry) => void;
  onSelectCaptureSource?: () => void;
}

export interface InAppLiveCaptureState {
  captureStream: MediaStream | null;
  captureMode: InAppCaptureMode | null;
  cameraFacing: 'environment' | 'user';
  setCameraFacing: (facing: 'environment' | 'user') => void;
  captureBusy: boolean;
  captureError: string | null;
  captureMessage: string | null;
  sessionInfo: AndroidCaptureSessionInfo | null;
  hasGetUserMedia: boolean;
  hasGetDisplayMedia: boolean;
  hasMediaRecorder: boolean;
  startScreenLiveCapture: (youtubeUrl?: string | null) => Promise<void>;
  startCameraLiveCapture: (facing?: 'environment' | 'user', youtubeUrl?: string | null) => Promise<void>;
  stopInAppCapture: () => Promise<void>;
  clearMessages: () => void;
}

function selectSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

export function useInAppLiveCapture({
  onTelemetryUpdated,
  onSelectCaptureSource,
}: UseInAppLiveCaptureOptions): InAppLiveCaptureState {
  const [captureStream, setCaptureStream] = useState<MediaStream | null>(null);
  const [captureMode, setCaptureMode] = useState<InAppCaptureMode | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<AndroidCaptureSessionInfo | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const sessionRef = useRef<AndroidCaptureSessionInfo | null>(null);
  const stoppingRef = useRef(false);

  const hasGetUserMedia =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const hasGetDisplayMedia =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

  const teardownLocalResources = useCallback(() => {
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      } catch {
        // ignore
      }
    }

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close(1000, 'Stopped');
      } catch {
        // ignore
      }
    }

    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    }

    setCaptureStream(null);
    setCaptureMode(null);
  }, []);

  const stopInAppCapture = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const activeSession = sessionRef.current;
    teardownLocalResources();
    sessionRef.current = null;
    setSessionInfo(null);
    setCaptureError(null);

    try {
      if (activeSession?.sessionId) {
        const res = await api.stopCaptureSession(activeSession.sessionId);
        onTelemetryUpdated(res.telemetry);
      }
      setCaptureMessage('In-app live capture stopped.');
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'Failed to stop capture session.');
    } finally {
      stoppingRef.current = false;
    }
  }, [onTelemetryUpdated, teardownLocalResources]);

  useEffect(() => {
    return () => {
      teardownLocalResources();
    };
  }, [teardownLocalResources]);

  const startStreamingMediaStream = useCallback(
    async (stream: MediaStream, mode: InAppCaptureMode, youtubeUrl?: string | null) => {
      if (!hasMediaRecorder) {
        for (const t of stream.getTracks()) t.stop();
        throw new Error('MediaRecorder API is unavailable in this browser. Use a modern Chrome or Edge browser.');
      }

      const created = await api.createCaptureSession(youtubeUrl);
      const mimeType = selectSupportedMimeType();
      const wsUrl = getWebIngestUrl(created.session, mimeType || 'video/webm');

      const videoTrack = stream.getVideoTracks()[0];
      const videoSettings = videoTrack?.getSettings?.() ?? {};
      const width = typeof videoSettings.width === 'number' && videoSettings.width > 0 ? videoSettings.width : 1280;
      const height = typeof videoSettings.height === 'number' && videoSettings.height > 0 ? videoSettings.height : 720;
      const hasAudio = stream.getAudioTracks().length > 0;

      streamRef.current = stream;
      sessionRef.current = created.session;
      setSessionInfo(created.session);
      setCaptureStream(stream);
      setCaptureMode(mode);
      onTelemetryUpdated(created.telemetry);
      onSelectCaptureSource?.();

      const handleTrackEnded = () => {
        if (!stoppingRef.current) {
          void stopInAppCapture();
        }
      };
      if (videoTrack) {
        videoTrack.onended = handleTrackEnded;
      }

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;
        let settled = false;

        ws.onopen = () => {
          settled = true;
          try {
            ws.send(
              JSON.stringify({
                type: 'telemetry',
                permissionGranted: true,
                videoStatus: 'CAPTURING',
                audioStatus: hasAudio ? 'AUDIO_CAPTURED' : 'AUDIO_NOT_AVAILABLE',
                width,
                height,
                audioSampleRate: hasAudio ? 44100 : 0,
                sentAtMs: Date.now(),
              }),
            );

            const recorderOptions: MediaRecorderOptions = {
              videoBitsPerSecond: 2_500_000,
              audioBitsPerSecond: 128_000,
            };
            if (mimeType) recorderOptions.mimeType = mimeType;

            const recorder = new MediaRecorder(stream, recorderOptions);
            recorderRef.current = recorder;

            recorder.ondataavailable = (ev) => {
              if (!ev.data || ev.data.size === 0) return;
              if (ws.readyState !== WebSocket.OPEN) return;
              // Guard backpressure to keep glass-to-glass latency low
              if (ws.bufferedAmount > 4 * 1024 * 1024) return;
              void ev.data.arrayBuffer().then((buf) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(buf);
                }
              });
            };

            recorder.onerror = () => {
              setCaptureError('Browser MediaRecorder interrupted live capture.');
              void stopInAppCapture();
            };

            recorder.start(350);

            heartbeatRef.current = window.setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                const trackSettings = videoTrack?.getSettings?.() ?? {};
                ws.send(
                  JSON.stringify({
                    type: 'telemetry',
                    permissionGranted: true,
                    width:
                      typeof trackSettings.width === 'number' && trackSettings.width > 0
                        ? trackSettings.width
                        : width,
                    height:
                      typeof trackSettings.height === 'number' && trackSettings.height > 0
                        ? trackSettings.height
                        : height,
                    audioStatus: stream.getAudioTracks().some((t) => t.readyState === 'live')
                      ? 'AUDIO_CAPTURED'
                      : 'AUDIO_NOT_AVAILABLE',
                    sentAtMs: Date.now(),
                  }),
                );
              }
            }, 3000);

            setCaptureMessage(
              mode === 'screen'
                ? 'Screen/Tab live capture active right inside the studio. Click START LIVE when ready to broadcast.'
                : 'In-app Camera + Mic live capture active. Click START LIVE when ready to broadcast.',
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        };

        ws.onerror = () => {
          if (!settled) {
            settled = true;
            reject(new Error(`Unable to connect live ingest WebSocket to ${wsUrl}`));
          } else {
            setCaptureError('Live ingest WebSocket disconnected.');
          }
        };

        ws.onclose = () => {
          if (wsRef.current === ws && !stoppingRef.current) {
            void stopInAppCapture();
          }
        };
      });
    },
    [hasMediaRecorder, onSelectCaptureSource, onTelemetryUpdated, stopInAppCapture],
  );

  const startScreenLiveCapture = useCallback(
    async (youtubeUrl?: string | null) => {
      setCaptureError(null);
      setCaptureMessage(null);
      if (!hasGetDisplayMedia) {
        setCaptureError(
          'This browser does not expose screen/tab capture (getDisplayMedia). Use "Start Camera + Mic Live" below directly inside this app.',
        );
        return;
      }

      setCaptureBusy(true);
      try {
        if (streamRef.current || wsRef.current) {
          await stopInAppCapture();
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: true,
        });
        await startStreamingMediaStream(stream, 'screen', youtubeUrl);
      } catch (err) {
        teardownLocalResources();
        setCaptureError(
          err instanceof Error
            ? `Screen capture not started: ${err.message}`
            : 'Screen capture permission cancelled or unavailable.',
        );
      } finally {
        setCaptureBusy(false);
      }
    },
    [hasGetDisplayMedia, startStreamingMediaStream, stopInAppCapture, teardownLocalResources],
  );

  const startCameraLiveCapture = useCallback(
    async (facing: 'environment' | 'user' = cameraFacing, youtubeUrl?: string | null) => {
      setCaptureError(null);
      setCaptureMessage(null);
      if (!hasGetUserMedia) {
        setCaptureError(
          'Camera and microphone APIs (getUserMedia) require HTTPS in a modern browser.',
        );
        return;
      }

      setCaptureBusy(true);
      try {
        if (streamRef.current || wsRef.current) {
          await stopInAppCapture();
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        setCameraFacing(facing);
        await startStreamingMediaStream(stream, 'camera', youtubeUrl);
      } catch (err) {
        teardownLocalResources();
        setCaptureError(
          err instanceof Error
            ? `Camera/Microphone capture error: ${err.message}`
            : 'Unable to access camera and microphone.',
        );
      } finally {
        setCaptureBusy(false);
      }
    },
    [cameraFacing, hasGetUserMedia, startStreamingMediaStream, stopInAppCapture, teardownLocalResources],
  );

  const clearMessages = useCallback(() => {
    setCaptureError(null);
    setCaptureMessage(null);
  }, []);

  return {
    captureStream,
    captureMode,
    cameraFacing,
    setCameraFacing,
    captureBusy,
    captureError,
    captureMessage,
    sessionInfo,
    hasGetUserMedia,
    hasGetDisplayMedia,
    hasMediaRecorder,
    startScreenLiveCapture,
    startCameraLiveCapture,
    stopInAppCapture,
    clearMessages,
  };
}
