# Multi-stage build for minimal image size
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /build

# Copy only package files first (better layer caching)
COPY src/mcp/bindings/package.json ./

# Install dependencies and clean cache in one layer
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Final stage - minimal runtime
FROM node:20-alpine

# Install Python, uv, and tsx in one layer
RUN apk add --no-cache python3 py3-pip \
    && pip3 install --no-cache-dir uv --break-system-packages \
    && npm install -g tsx \
    && npm cache clean --force \
    && rm -rf /root/.npm

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
