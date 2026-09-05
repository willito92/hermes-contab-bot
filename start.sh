#!/bin/bash
set -e

echo "=========================================="
echo "   INICIANDO HERMES CONTABLE AGENT BOT    "
echo "=========================================="

HERMES_DIR="/root/.hermes"
mkdir -p "$HERMES_DIR"

cat <<EOF > "$HERMES_DIR/.env"
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_ALLOWED_USERS=${TELEGRAM_ALLOWED_USERS}
TELEGRAM_HOME_CHANNEL=${TELEGRAM_ALLOWED_USERS}
GEMINI_API_KEY=${GEMINI_API_KEY}
GOOGLE_API_KEY=${GEMINI_API_KEY}
EOF

if [ -n "$OPENROUTER_API_KEY" ]; then
  echo "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}" >> "$HERMES_DIR/.env"
fi

PROVIDER="${MODEL_PROVIDER:-google}"
DEFAULT_MODEL="${MODEL_DEFAULT:-gemini-3.6-flash}"

cat <<EOF > "$HERMES_DIR/config.yaml"
_config_version: 40
model:
  provider: ${PROVIDER}
  default: ${DEFAULT_MODEL}
agent:
  max_turns: 150
display:
  tool_progress: all
mcp_servers:
  econtabilidad:
    command: node
    args:
      - /app/mcp-server/index.js
      - --mcp
    env:
      DATABASE_URL: "${DATABASE_URL}"
    enabled: true
EOF

echo "✓ Proveedor configurado: $PROVIDER ($DEFAULT_MODEL)"
echo "✓ Conexión a Telegram y Base de Datos configurada"
echo "🚀 Arrancando Telegram Gateway en Railway..."

exec hermes gateway run
