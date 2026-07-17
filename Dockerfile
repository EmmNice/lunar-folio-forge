# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS builder
WORKDIR /app

# Install deps first (layer-cached unless lockfile changes)
COPY bun.lockb bunfig.toml package.json ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
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
