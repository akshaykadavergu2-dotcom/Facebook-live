# LIVECAST STUDIO

Production-ready broadcast control room for encoding and streaming authorized video sources and live graphics overlays to **Facebook Live** via **RTMPS / RTMP**.

## Architecture

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 (OBS-inspired dark broadcast control room)
- **Backend**: Node.js 22 + Express + WebSockets (`ws`) + Multer + Rate Limiting
- **Stream Engine**: Real FFmpeg process management (`libx264` H.264 video @ 30 FPS, `aac` audio, 2-second keyframe interval `-g 60`, `1280x720` & `1920x1080` profiles, live `filter_complex` graphics overlays)
- **Credential Security**: Facebook Stream Keys are encrypted at rest with **AES-256-GCM** on the server, never stored in `localStorage`, never returned to the browser in plaintext, and redacted from all logs.

## YouTube Compliance Policy

LIVECAST STUDIO validates YouTube share URLs (`youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/live/...`) and loads them inside the official **YouTube IFrame Player API** for preview only. It intentionally does **not** scrape YouTube, bypass DRM, or extract protected streams into FFmpeg. To broadcast live via RTMP, use **Uploaded Authorized Video Files** (MP4, MOV, WebM, MKV) or **Authorized Direct Media URLs** (direct MP4 / HLS streams).

---

## Local Development Setup

### Prerequisites
- **Node.js 22+**
- **FFmpeg & FFprobe** installed on `PATH` (with `libx264`, `aac`, `libfreetype`, and `gnutls`/TLS support for `rtmps://`)
  - Ubuntu/Debian: `sudo apt-get update && sudo apt-get install -y ffmpeg fonts-liberation`
  - macOS: `brew install ffmpeg`

### Run Locally
1. Copy `.env.example` to `.env` and set secrets:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the full-stack development server (Express + WebSocket + Vite):
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`.

### Production Build & Run (Without Docker)
```bash
npm run build
NODE_ENV=production npm start
```

---

## Docker & VPS Deployment Guide

> **Important**: Never run FFmpeg inside serverless functions (Vercel, Netlify Functions, AWS Lambda) due to execution time limits, CPU throttling, and lack of persistent process control. Deploy LIVECAST STUDIO on a dedicated VPS or container host (e.g., DigitalOcean, Hetzner, AWS EC2, Railway, Fly.io, Google Cloud Run with min-instances/always-on CPU or Compute Engine).

### Recommended VPS Specs
- **720p30 stream**: Minimum 2 vCPU, 2 GB RAM, >= 10 Mbps sustained upload bandwidth
- **1080p30 stream**: Minimum 4 vCPU, 4 GB RAM, >= 15 Mbps sustained upload bandwidth

### Deploy with Docker Compose
1. Generate strong secrets:
   ```bash
   export CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)
   export SESSION_SECRET=$(openssl rand -hex 32)
   export STUDIO_ADMIN_PASSWORD="your-strong-operator-password"
   ```
2. Build and start:
   ```bash
   docker compose up -d --build
   ```
3. Place a TLS reverse proxy (Caddy or Nginx) in front of port `3000` with WebSocket upgrade headers (`Upgrade` and `Connection: upgrade`) enabled for `/ws`.

### Facebook Live RTMP Setup
1. Open **Facebook Live Producer** -> **Streaming Software**.
2. Copy the **Server URL** (usually `rtmps://live-api-s.facebook.com:443/rtmp/`) and **Stream Key**.
3. Paste both in LIVECAST STUDIO (**Settings** or **Live Studio -> Facebook RTMP Target**) and click **Save Credentials**.
4. Select an uploaded MP4 (or click **Generate Sample MP4** to test immediately), verify overlays, and click **START LIVE**.

---

## API Reference

- `POST /api/stream/start` — Start FFmpeg RTMP broadcast (prevents duplicate active streams)
- `POST /api/stream/stop` — Gracefully stop active FFmpeg process
- `GET /api/stream/status` — Current telemetry and sanitized FFmpeg logs
- `POST /api/stream/validate-pipeline` — Run a 2-second local FFmpeg dry-run encode with overlays
- `POST /api/video/upload` — Upload and probe authorized video file (MP4/MOV/WebM/MKV)
- `POST /api/overlays` — Save overlay configuration (headline, lower-third, scrolling ticker, PNG logo placement)
- `POST /api/overlays/logo` — Upload transparent PNG logo
- `WS /ws` — Real-time stream status, FPS/bitrate telemetry, and sanitized logs
