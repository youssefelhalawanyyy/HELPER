#!/bin/zsh
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo ""
echo " ======================================================="
echo "  DEVDECK LIVE LAUNCHER (macOS -> iPhone PWA)"
echo " ======================================================="
echo "  Folder: $(pwd)"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[SETUP] Node.js not found. Checking Homebrew..."
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "[ERROR] Node.js is not installed. Install Node.js LTS from https://nodejs.org and try again."
    read -r "?Press Enter to close..."
    exit 1
  fi
fi

if [ ! -f "node_modules/tsx/dist/cli.mjs" ]; then
  echo "[SETUP] Installing DevDeck dependencies (first run)..."
  npm install || npm install --legacy-peer-deps
fi

if [ ! -f "mac-bridge/dist/index.js" ]; then
  echo "[BUILD] Compiling DevDeck macOS Bridge..."
  npm run build -w mac-bridge >/dev/null 2>&1 || true
fi

export NODE_NO_WARNINGS=1
echo "[LIVE] Starting DevDeck macOS Bridge + Free Cloudflare HTTPS Tunnel..."
echo "       (Scan the QR code below with your iPhone Camera once it appears!)"
echo ""
npm run live
