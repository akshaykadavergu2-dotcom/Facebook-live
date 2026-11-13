FROM node:22-bookworm-slim AS base

# Install FFmpeg (with libx264, freetype, gnutls/RTMPS) and Liberation fonts for drawtext overlays
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-liberation ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies and build Vite frontend
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Prune devDependencies for leaner production container while keeping runtime deps
RUN npm prune --omit=dev

# Create persistent directories for encrypted state and uploaded media
RUN mkdir -p /app/.data /app/uploads/videos /app/uploads/overlays \
  && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "server.ts"]
