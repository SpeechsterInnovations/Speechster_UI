#!/usr/bin/env bash

# Clean Terminal Window
reset

set -e
echo "───────────────────────────────────────────────"
echo "Building and Packaging Script For Speechster UI"
echo "───────────────────────────────────────────────"

# 0 Kill any existing backend processes (cleanup)
echo "▶ Cleaning up old instances (ports 8080 & 8443)..."
# Function to silently kill any process bound to a port (no sudo)
kill_port() {
  PORT=$1
  PIDS=$(netstat -tulpn 2>/dev/null | grep ":$PORT" | awk '{print $7}' | cut -d'/' -f1 | grep -E '^[0-9]+$' || true)
  for PID in $PIDS; do
    if [ -n "$PID" ]; then
      echo "   → Killing process $PID on port $PORT"
      kill -9 "$PID" 2>/dev/null || true
    fi
  done
}

# Kill 8080 + 8443 + any old speechster binaries
kill_port 8080
kill_port 8443
pkill -f speechsterUI 2>/dev/null || true
sleep 1

# Clean old build
rm -rf dist/ speechsterUI* || true
mkdir -p dist

# 1 Bundle the server (external packages only)
echo "▶ Bundling server.js → dist/backend.cjs"
npx esbuild server.js \
  --bundle \
  --platform=node \
  --target=node18 \
  --outfile=dist/backend.cjs \
  --packages=external

# 2 Package into standalone binaries (Linux/Win/macOS)
echo "▶ Creating binaries with pkg..."
pkg dist/backend.cjs \
  --targets node18-linux-x64,node18-win-x64,node18-macos-x64 \
  --output speechsterUI

# 3 Prepare runtime folders next to each binary
echo "▶ Copying assets (certs/, public/, data/)..."
for BIN in speechsterUI*; do
  [ -f "$BIN" ] || continue
  BIN_DIR="$(dirname "$BIN")"
  mkdir -p "$BIN_DIR"/certs "$BIN_DIR"/public "$BIN_DIR"/data
  cp -r certs public "$BIN_DIR"/ 2>/dev/null || true
done

# 44 Auto-run the local binary (Linux build)
echo "▶ Launching local binary (Linux build)"
./speechsterUI-linux
