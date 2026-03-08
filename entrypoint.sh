#!/bin/sh
# Replace the API_BASE placeholder with the actual environment variable
# This runs at container startup so each team deployment gets its own backend URL
API_BASE="${API_BASE:-http://localhost:8001}"

# Replace placeholder in app.js
sed -i "s|%%API_BASE%%|${API_BASE}|g" /usr/share/nginx/html/app.js

echo "Starting EventFlow Storefront"
echo "  API_BASE: ${API_BASE}"

exec nginx -g 'daemon off;'
