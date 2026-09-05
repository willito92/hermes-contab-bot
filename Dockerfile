FROM python:3.12-slim

# Instalar Node.js para el servidor MCP de contabilidad
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar hermes-agent y el SDK de mcp
RUN pip install --no-cache-dir hermes-agent mcp

# Copiar el servidor MCP e instalar sus dependencias
COPY mcp-server /app/mcp-server
RUN cd /app/mcp-server && npm install --production

# Copiar script de arranque
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
