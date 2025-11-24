# Multi-stage build for minimal image size
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /build

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files including lock file (better layer caching)
COPY src/mcp/bindings/package.json src/mcp/bindings/pnpm-lock.yaml ./

# Install dependencies with frozen lockfile for deterministic builds
RUN pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# Final stage - minimal runtime
FROM node:20-slim

# Install Python, uv, and tsx in one layer
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && pip3 install --no-cache-dir uv --break-system-packages \
    && npm install -g tsx \
    && npm cache clean --force \
    && rm -rf /root/.npm /var/lib/apt/lists/*

# Set working directory
WORKDIR /workspace

# Copy installed dependencies from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy source files
COPY src/mcp/bindings/src/executor.ts ./executor.ts
COPY src/mcp/bindings/src/executor-utils.ts ./executor-utils.ts
COPY src/mcp/bindings/src/client.ts ./client.ts
COPY src/mcp/bindings/src/converter.ts ./converter.ts
COPY src/mcp/bindings/package.json ./package.json

# Keep container running
CMD ["tail", "-f", "/dev/null"]
