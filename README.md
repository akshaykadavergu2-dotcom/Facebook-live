# LIVECAST STUDIO

Production-ready broadcast control room for encoding and streaming authorized video sources and live graphics overlays to **Facebook Live** via **RTMPS / RTMP**.

## Architecture (Split Netlify Frontend + Persistent Node.js Backend)

Because Netlify is a static/serverless host and **FFmpeg RTMP streaming requires a persistent stateful process**, production deployment uses a split architecture:

1. **Frontend (Netlify — `https://streamkarolive.netlify.app`)**
   - React 19 + TypeScript + Tailwind CSS v4 (built via `npm run build` -> `dist/`).
   - Connects to the separate Node.js backend via `VITE_API_BASE_URL` for REST APIs, WebSocket telemetry (`/ws`), and preview media (`/media/*`).
   - **No Netlify Functions are used for streaming.**

2. **Backend (`/backend` — Render, Railway, Fly.io, or VPS)**
   - Standalone Node.js 22 + Express + WebSockets (`ws`) + Multer + Rate Limiting + FFmpeg.
   - Configured with CORS for `https://streamkarolive.netlify.app`.
   - Encrypts Facebook Stream Keys at rest using **AES-256-GCM** (`CREDENTIAL_ENCRYPTION_KEY`), never exposes them in API responses or logs, and never stores them in browser `localStorage`.

---

## Deploying the Backend (Render / Persistent Docker Host)

1. Push this repository to GitHub/GitLab.
2. In **Render**, click **New + -> Web Service** (or use **Blueprint** with `backend/render.yaml`).
3. Configure the Render service:
   - **Root Directory**: `backend`
   - **Runtime / Environment**: `Docker` (uses `backend/Dockerfile` which installs Node 22, FFmpeg, and Liberation fonts)
   - **Health Check Path**: `/api/health`
   - **Persistent Disk** (recommended): Mount at `/app/.data` so encrypted credentials, stream history, and overlays survive redeploys.
4. Set **Backend Environment Variables** in Render:
   ```env
   NODE_ENV=production
   PORT=3000
   ALLOWED_CORS_ORIGIN=https://streamkarolive.netlify.app
   CREDENTIAL_ENCRYPTION_KEY=<run: openssl rand -hex 32>
   SESSION_SECRET=<run: openssl rand -hex 32>
   STUDIO_ADMIN_PASSWORD=<optional strong operator password>
   MAX_UPLOAD_MB=500
   ```
5. Deploy and verify `https://<your-render-service>.onrender.com/api/health` returns JSON `{"ok": true, ...}`.

*(You can also run `/backend` on any Ubuntu/Docker VPS via `docker build -t livecast-backend ./backend && docker run -d -p 3000:3000 --env-file ./backend/.env livecast-backend`.)*

---

## Configuring Netlify Frontend (`streamkarolive.netlify.app`)

1. Open **Netlify Dashboard -> Site configuration -> Environment variables**.
2. Add **one** frontend environment variable (do NOT put secrets or stream keys here):
   - **Key**: `VITE_API_BASE_URL`
   - **Value**: `https://<your-render-service>.onrender.com` *(no trailing slash)*
3. Verify Netlify Build settings (`netlify.toml` is included):
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Trigger **Deploys -> Trigger deploy -> Clear cache and deploy site** so Vite bakes `VITE_API_BASE_URL` into the bundle.

---

## Local Development (Unified Server)

```bash
cp .env.example .env
npm install
npm run dev
```
Open `http://localhost:3000` (runs Express + WebSockets + Vite middleware on a single port).

---

## API Endpoints Reference

- `GET /api/health` — Returns backend health, FFmpeg availability, and stream state
- `GET /api/stream/status` — Current telemetry and sanitized FFmpeg logs
- `GET /api/stream/credentials` / `POST /api/stream/credentials` / `DELETE /api/stream/credentials` — Manage AES-256-GCM encrypted Facebook RTMP URL & Stream Key (masked in responses; `/api/rtmp/config` alias also supported)
- `POST /api/stream/start` — Start FFmpeg H.264/AAC RTMP broadcast
- `POST /api/stream/stop` — Gracefully stop active FFmpeg process
- `POST /api/stream/validate-pipeline` — 2-second local FFmpeg dry-run encode check
- `POST /api/video/upload` — Upload & probe authorized MP4/MOV/WebM/MKV video
- `POST /api/overlays` & `POST /api/overlays/logo` — Configure overlays and transparent PNG corner logo
- `WS /ws` — Real-time stream status, FPS/bitrate telemetry, and sanitized logs

---

## Deployment Verification Checklist

- [ ] Backend `/api/health` returns HTTP `200` JSON with `"ok": true` and `"ffmpegAvailable": true`
- [ ] Backend `ALLOWED_CORS_ORIGIN` includes `https://streamkarolive.netlify.app`
- [ ] Netlify `VITE_API_BASE_URL` is set to the Render/VPS backend HTTPS URL and site is rebuilt
- [ ] Missing backend routes (e.g. `/api/nonexistent`) return HTTP `404` JSON instead of HTML
- [ ] Saving Facebook RTMP credentials via `POST /api/stream/credentials` returns `200` JSON with `maskedStreamKey` and never exposes the raw key
- [ ] Mobile layout (375px width) has zero horizontal scrollbars
