# ---------------------------------------------------------------------------
# YT Tools — production image
#
# Bundles Node, Python, yt-dlp and ffmpeg in one container. Standard Vercel
# serverless functions cannot run these binaries, so deploy this image on
# Railway, Fly.io, Render, or any VPS with a Docker runtime.
# ---------------------------------------------------------------------------

# --- Stage 1: install dependencies -----------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# --- Stage 2: build the Next.js app ----------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Stage 3: runtime -------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# ffmpeg does the MP3 encoding and the video/audio merge; python3 runs yt-dlp;
# ca-certificates is needed for HTTPS requests to YouTube.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp as its pure-Python zipapp, run by the distro's Python 3.11.
#
# Not the `yt-dlp_linux` standalone binary: that one is x86_64 only, so the
# multi-arch release build failed on linux/arm64 with exit code 127. The zipapp
# is architecture-independent, 2.9 MB instead of 35 MB, and starts in under a
# second rather than unpacking a PyInstaller bundle on every invocation.
ARG YT_DLP_VERSION=2026.08.19
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" \
        -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version

# The standalone build in .next/standalone carries only the modules it needs.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Run unprivileged. yt-dlp writes only into the OS temp directory.
RUN useradd --system --uid 1001 --create-home nextjs \
    && chown -R nextjs:nextjs /app
USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
