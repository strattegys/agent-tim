FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    gettext-base \
    && rm -rf /var/lib/apt/lists/*

# Install nanobot
RUN pip install --no-cache-dir nanobot-ai

# Create app directory
WORKDIR /app

# Copy nanobot configuration
COPY .nanobot/ /root/.nanobot/

# Make tools executable
RUN chmod +x /root/.nanobot/tools/*.sh

# Create workspace directory
RUN mkdir -p /app/workspace

# Copy entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
