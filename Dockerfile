# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS builder
WORKDIR /app

# Install deps first (layer-cached unless lockfile changes)
COPY bun.lock bunfig.toml package.json ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .

# Vite bakes VITE_* vars into the client bundle at build time, not runtime.
# Railway passes service variables as Docker build args, but only if the
# Dockerfile declares them with ARG. Without these declarations, the vars
# are invisible to `bun run build` and the browser bundle gets empty strings,
# causing the Supabase client to throw "Missing environment variable" on every page.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_ADMIN_IDS
ARG VITE_ADMIN_DOMAIN
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_ADMIN_IDS=$VITE_ADMIN_IDS
ENV VITE_ADMIN_DOMAIN=$VITE_ADMIN_DOMAIN

RUN bun run build
# Nitro node-server preset outputs to .output/
# .output/server/index.mjs  — standalone Node.js server (deps bundled by rollup)
# .output/public/            — static assets served by the same process

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM oven/bun:1.2-slim
WORKDIR /app

# Only copy the build artifact — no source or node_modules needed
COPY --from=builder /app/.output ./.output

# Railway injects PORT at runtime; Nitro node-server reads it automatically.
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
