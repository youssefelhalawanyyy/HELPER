#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.devdeck/node/bin:$PATH"

REPO_GIT="https://github.com/youssefelhalawanyyy/HELPER.git"
REPO_TAR="https://github.com/youssefelhalawanyyy/HELPER/archive/refs/heads/main.tar.gz"

# Support both direct file execution AND piped execution (`curl -fsSL ... | zsh`) with zero Gatekeeper prompts!
SCRIPT_DIR="$(cd "$(dirname "${0:-.}")" 2>/dev/null && pwd || pwd)"
if [ -f "$SCRIPT_DIR/package.json" ] && [ -d "$SCRIPT_DIR/mac-bridge" ]; then
  TARGET_DIR="$SCRIPT_DIR"
else
  TARGET_DIR="$HOME/HELPER"
fi

echo ""
echo " ================================================================"
echo "  DEVDECK AUTONOMOUS SELF-HEALING BRIDGE (macOS -> iPhone PWA)"
echo " ================================================================"
echo "  Folder: $TARGET_DIR"
echo ""

# 1. Verify Node.js (auto-install via Homebrew OR zero-sudo standalone binary from nodejs.org!)
if ! command -v node >/dev/null 2>&1; then
  echo "[AUTOPILOT] Node.js not found. Checking Homebrew..."
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

# 2. Download or update HELPER repository automatically (works even without Git!)
if [ ! -f "$TARGET_DIR/package.json" ]; then
  if command -v git >/dev/null 2>&1; then
    echo "[AUTOPILOT] Cloning HELPER repository..."
    git clone "$REPO_GIT" "$TARGET_DIR"
  else
    echo "[AUTOPILOT] Downloading HELPER tarball (no Git required)..."
    curl -fsSL "$REPO_TAR" | tar -xz -C /tmp
    rm -rf "$TARGET_DIR"
    mv /tmp/HELPER-main "$TARGET_DIR"
  fi
fi

cd "$TARGET_DIR"
if [ -d ".git" ]; then
  git pull --ff-only >/dev/null 2>&1 || true
fi

# 3. Clear stuck port 4747 if occupied by an unresponsive process
if lsof -ti tcp:4747 >/dev/null 2>&1; then
  if ! curl -fsS --max-time 2 http://127.0.0.1:4747/api/health >/dev/null 2>&1; then
    echo "[AUTOPILOT] Clearing unresponsive process on port 4747..."
    lsof -ti tcp:4747 | xargs kill -9 2>/dev/null || true
  fi
fi

# 4. Self-healing npm install
if [ ! -f "node_modules/tsx/dist/cli.mjs" ]; then
  echo "[AUTOPILOT] Installing DevDeck dependencies..."
  npm install --no-audit --no-fund || (npm cache clean --force >/dev/null 2>&1; npm install --no-audit --no-fund --legacy-peer-deps)
fi

# 5. Pre-compile mac-bridge
if [ ! -f "mac-bridge/dist/index.js" ]; then
  echo "[AUTOPILOT] Compiling DevDeck macOS Bridge..."
  npm run build -w mac-bridge >/dev/null 2>&1 || true
fi

export NODE_NO_WARNINGS=1
echo "[LIVE] Starting DevDeck macOS Bridge + Free Cloudflare HTTPS Tunnel..."
echo "       (Your QR Code and 6-Digit PIN will appear below AND in /setup!)"
echo ""
npm run live
