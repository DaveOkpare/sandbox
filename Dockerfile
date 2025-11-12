FROM python:3.13-slim

# Install Node.js and npm
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install tsx globally
RUN npm install -g tsx

# Set working directory
WORKDIR /workspace;

# Set PYTHONPATH so mounted files can be imported directly
ENV PYTHONPATH=/workspace

# Keep container running for exec commands
CMD ["tail", "-f", "/dev/null"]
