#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.devdeck/node/bin:$PATH"

echo ""
echo " ================================================================"
echo "  DEVDECK AUTONOMOUS SELF-HEALING BRIDGE (macOS -> iPhone PWA)"
echo " ================================================================"
echo "  Folder: $(pwd)"
echo ""

# 1. Verify Node.js (auto-install via Homebrew OR zero-sudo standalone binary from nodejs.org!)
if ! command -v node >/dev/null 2>&1; then
  echo "[AUTOPILOT] Node.js not found. Attempting automatic install..."
  if command -v brew >/dev/null 2>&1; then
    brew install node || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[AUTOPILOT] Downloading standalone Node.js v22 LTS (no sudo required)..."
  ARCH_RAW="$(uname -m)"
  if [ "$ARCH_RAW" = "arm64" ]; then NODE_ARCH="arm64"; else NODE_ARCH="x64"; fi
  mkdir -p "$HOME/.devdeck/node"
  curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-${NODE_ARCH}.tar.gz" | tar -xz -C "$HOME/.devdeck/node" --strip-components=1
  export PATH="$HOME/.devdeck/node/bin:$PATH"
fi

# 2. Clear stuck port 4747 if occupied by an unresponsive process
if lsof -ti tcp:4747 >/dev/null 2>&1; then
  if ! curl -fsS --max-time 2 http://127.0.0.1:4747/api/health >/dev/null 2>&1; then
    echo "[AUTOPILOT] Clearing unresponsive process on port 4747..."
    lsof -ti tcp:4747 | xargs kill -9 2>/dev/null || true
  fi
fi

# 3. Self-healing npm install
if [ ! -f "node_modules/tsx/dist/cli.mjs" ]; then
  echo "[AUTOPILOT] Installing DevDeck dependencies..."
  npm install --no-audit --no-fund || (npm cache clean --force >/dev/null 2>&1; npm install --no-audit --no-fund --legacy-peer-deps)
fi

# 4. Pre-compile mac-bridge
if [ ! -f "mac-bridge/dist/index.js" ]; then
  echo "[AUTOPILOT] Compiling DevDeck macOS Bridge..."
  npm run build -w mac-bridge >/dev/null 2>&1 || true
fi

export NODE_NO_WARNINGS=1
echo "[LIVE] Starting DevDeck macOS Bridge + Free Cloudflare HTTPS Tunnel..."
echo "       (Your QR Code and 6-Digit PIN will appear below AND in /setup!)"
echo ""
npm run live
