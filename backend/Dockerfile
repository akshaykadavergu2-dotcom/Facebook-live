FROM node:22-bookworm-slim

# Install FFmpeg (H.264, AAC, FreeType, GnuTLS/RTMPS) and Liberation fonts for drawtext overlays
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-liberation ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/.data /app/uploads/videos /app/uploads/overlays \
  && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server.ts"]
