# syntax=docker/dockerfile:1.7
#
# Real or AI? — production image.
#
# Multi-stage build using Next.js `output: "standalone"`:
#   deps     — installs node_modules (cached layer)
#   builder  — runs `next build`, produces .next/standalone/
#   runner   — minimal runtime image, non-root, ~150MB
#
# Runtime layout (in the runner image):
#   /app/server.js             — standalone Next.js server (entrypoint)
#   /app/.next/static/         — client JS/CSS chunks
#   /app/public/               — static public assets
#   /app/images/{ai,real}/     — baked-in placeholder images (overridable)
#   /app/data/                 — SQLite volume mount point (auto-created)
#
# Override baked-in images by bind-mounting /app/images.
# Point at a remote DB with ROA_DB_URL / TURSO_DATABASE_URL.

# ---------- deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# OpenSSL is required by some Node native modules on Debian.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# ---------- builder ----------
FROM deps AS builder
WORKDIR /app

COPY . .
# Next.js prunes devDependencies for the standalone output during build.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- runner ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Default to a file-backed SQLite DB inside the volume mount point.
    ROA_DB_URL=file:/app/data/realorai.db \
    # Default to baked-in images; overridable via volume mount.
    ROA_IMAGES_DIR=/app/images

# Create an unprivileged user for the runtime.
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs && \
    mkdir -p /app/data /app/images && chown -R nextjs:nodejs /app

# Standalone server + its node_modules trace.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static client assets (not included by standalone by default).
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Public folder.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Baked-in placeholder images (consumer replaces with real content).
COPY --from=builder --chown=nextjs:nodejs /app/images ./images

USER nextjs

EXPOSE 3000

# Lightweight healthcheck against the homepage.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
