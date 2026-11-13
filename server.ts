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
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (hasBuiltDist) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
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
