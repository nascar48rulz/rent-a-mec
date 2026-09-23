#!/usr/bin/env bash
# Run Node app (HTTP) + Caddy (TLS) together for local or prod-style setup.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CADDY_BIN="${CADDY_BIN:-$ROOT/deploy/caddy}"
CADDYFILE="${1:-$ROOT/deploy/Caddyfile.local}"

# Force Node to HTTP so Caddy owns TLS
export HTTPS=0
export PORT="${PORT:-3847}"
export APP_URL="${APP_URL:-https://localhost}"

# Seed if DB empty / missing
if [[ ! -f "${RAM_DB_PATH:-/tmp/rent-a-mec-data/rentamec.db}" ]]; then
  node scripts/seed.js || true
fi

# Start Node in background
node server/index.js &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null; wait $APP_PID 2>/dev/null' EXIT

sleep 1
echo "Node app PID $APP_PID on :$PORT (HTTP)"
echo "Starting Caddy with $CADDYFILE ..."
exec "$CADDY_BIN" run --config "$CADDYFILE"
