# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
# Playwright image ships with Chromium + all deps pre-installed
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runtime

WORKDIR /app

# FFmpeg for video mixing
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy built output and production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Playwright browsers (Chromium already in the base image)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8788
CMD ["node", "dist/index.js"]
