FROM python:3.13-slim

# Install Node.js and npm (required for MCP servers that use npx)
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install mcp2py and its dependencies
RUN pip install --no-cache-dir mcp2py fastmcp

# Set working directory
WORKDIR /workspace

# Set PYTHONPATH so mounted files can be imported directly
ENV PYTHONPATH=/workspace

# Keep container running for exec commands
CMD ["tail", "-f", "/dev/null"]
