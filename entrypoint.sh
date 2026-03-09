#!/bin/sh
# Replace placeholders with actual environment variables
# This runs at container startup so each team deployment gets its own config
API_BASE="${API_BASE:-http://localhost:8001}"
DEVIN_API_URL="${DEVIN_API_URL:-https://api.devin.ai/v1}"
DEVIN_API_KEY="${DEVIN_API_KEY:-}"
WEBHOOK_URL="${WEBHOOK_URL:-}"

# Replace placeholders in app.js
sed -i "s|%%API_BASE%%|${API_BASE}|g" /usr/share/nginx/html/app.js

# Replace placeholders in ops.js
sed -i "s|%%API_BASE%%|${API_BASE}|g" /usr/share/nginx/html/ops.js
sed -i "s|%%DEVIN_API_URL%%|${DEVIN_API_URL}|g" /usr/share/nginx/html/ops.js
sed -i "s|%%DEVIN_API_KEY%%|${DEVIN_API_KEY}|g" /usr/share/nginx/html/ops.js
sed -i "s|%%WEBHOOK_URL%%|${WEBHOOK_URL}|g" /usr/share/nginx/html/ops.js

echo "Starting EventFlow Storefront"
echo "  API_BASE: ${API_BASE}"
echo "  DEVIN_API_URL: ${DEVIN_API_URL}"
echo "  DEVIN_API_KEY: [${DEVIN_API_KEY:+set}]"
echo "  WEBHOOK_URL: ${WEBHOOK_URL}"

exec nginx -g 'daemon off;'
