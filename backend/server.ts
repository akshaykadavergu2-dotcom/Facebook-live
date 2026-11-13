import 'dotenv/config';
import http from 'node:http';
import {
  attachWebSocketServer,
  createLivecastApp,
  seedInitialSampleVideo,
} from './src/app.ts';
import { streamManager } from './src/ffmpeg.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startBackend(): Promise<void> {
  const app = createLivecastApp({ standaloneBackend: true });
  await seedInitialSampleVideo();

  const server = http.createServer(app);
  attachWebSocketServer(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LIVECAST STUDIO backend listening on http://0.0.0.0:${PORT}`);
  });

  const gracefulShutdown = async () => {
    await streamManager.stopStream();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

startBackend().catch((err) => {
  console.error('Failed to start LIVECAST STUDIO backend:', err);
  process.exit(1);
});
