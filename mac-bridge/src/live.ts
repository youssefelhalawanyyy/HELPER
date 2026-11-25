import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  killChildProcessTree,
  resolveTsxCliMjs,
  spawnCloudflaredQuickTunnel,
} from './platform/cloudflared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '..');
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 4747);
const PUBLIC_PWA_URL = (process.env.PUBLIC_PWA_URL || 'https://helper-nu-swart.vercel.app').replace(/\/+$/, '');
const OS_LABEL =
  process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux';

let tunnelChild: ChildProcess | null = null;
let bridgeChild: ChildProcess | null = null;
let bridgeStarted = false;
let currentTunnelUrl = '';
let restartingBridge = false;
let shuttingDown = false;
const DIST_ENTRY = path.join(BRIDGE_ROOT, 'dist', 'index.js');
const SRC_ENTRY = path.join(BRIDGE_ROOT, 'src', 'index.ts');

function spawnBridgeProcess(tunnelUrl: string): void {
  const tsxCli = resolveTsxCliMjs();
  const useCompiled =
    !tsxCli ||
    (fs.existsSync(DIST_ENTRY) &&
      (!fs.existsSync(SRC_ENTRY) || fs.statSync(DIST_ENTRY).mtimeMs >= fs.statSync(SRC_ENTRY).mtimeMs));

  const env = {
    ...process.env,
    BRIDGE_PORT: String(BRIDGE_PORT),
    PUBLIC_PWA_URL,
    PUBLIC_BRIDGE_URL: tunnelUrl,
  };

  let entryArgs: string[];
  if (useCompiled && fs.existsSync(DIST_ENTRY)) {
    entryArgs = [DIST_ENTRY];
  } else if (tsxCli) {
    entryArgs = [tsxCli, SRC_ENTRY];
  } else {
    console.error('[ERROR] Neither compiled dist/index.js nor tsx CLI found. Run "npm install" first.');
    process.exit(1);
  }

  // Spawn node.exe directly with shell: false — immune to Windows spaces/cmd.exe quoting & EINVAL!
  const child = spawn(process.execPath, entryArgs, {
    cwd: BRIDGE_ROOT,
    stdio: 'inherit',
    env,
    windowsHide: false,
  });

  bridgeChild = child;

  child.on('exit', (code) => {
    if (bridgeChild === child) bridgeChild = null;
    if (shuttingDown) return;
    if (restartingBridge) {
      restartingBridge = false;
      setTimeout(() => spawnBridgeProcess(currentTunnelUrl), 250);
      return;
    }
    cleanup();
    process.exit(code ?? 0);
  });
}

function startBridge(tunnelUrl: string): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  currentTunnelUrl = tunnelUrl;
  if (tunnelUrl) {
    console.log(`\n✅ Tunnel live: ${tunnelUrl}`);
    console.log(`🔗 Starting DevDeck ${OS_LABEL} Bridge with 1-scan Vercel QR code (auto-reload enabled)...\n`);
  } else {
    console.log(`\n⚠️  Cloudflare tunnel unavailable — starting DevDeck ${OS_LABEL} Bridge in Local Wi-Fi / LAN mode...\n`);
  }
  spawnBridgeProcess(tunnelUrl);

  // Hot-reload ONLY the bridge process when dist/index.js is rebuilt, keeping the Cloudflare tunnel URL alive!
  let lastMtime = fs.existsSync(DIST_ENTRY) ? fs.statSync(DIST_ENTRY).mtimeMs : 0;
  fs.watchFile(DIST_ENTRY, { interval: 1500 }, (curr) => {
    if (shuttingDown || !curr.mtimeMs || curr.mtimeMs === lastMtime) return;
    lastMtime = curr.mtimeMs;
    if (bridgeChild && !bridgeChild.killed) {
      console.log('\n♻️  Detected updated bridge build — hot-reloading bridge (keeping tunnel URL alive)...\n');
      restartingBridge = true;
      killChildProcessTree(bridgeChild);
    }
  });
}

function inspectChunk(chunk: Buffer): void {
  const text = chunk.toString('utf8');
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !bridgeStarted) {
    startBridge(match[0]);
  }
}

function cleanup(): void {
  shuttingDown = true;
  fs.unwatchFile(DIST_ENTRY);
  killChildProcessTree(bridgeChild);
  killChildProcessTree(tunnelChild);
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

async function main(): Promise<void> {
  console.log(`\n🚀 DevDeck Live Launcher (${OS_LABEL}) — starting free Cloudflare HTTPS tunnel...\n`);
  try {
    tunnelChild = await spawnCloudflaredQuickTunnel(`http://127.0.0.1:${BRIDGE_PORT}`, true);
    tunnelChild.stdout?.on('data', inspectChunk);
    tunnelChild.stderr?.on('data', inspectChunk);

    // Fallback to LAN mode if tunnel doesn't report URL within 20s instead of hanging forever
    const fallbackTimer = setTimeout(() => {
      if (!bridgeStarted) {
        startBridge('');
      }
    }, 20_000);
    fallbackTimer.unref();

    tunnelChild.on('error', (err) => {
      console.warn(`[warn] cloudflared failed (${err.message}) — falling back to Local LAN mode.`);
      if (!bridgeStarted) startBridge('');
    });

    tunnelChild.on('exit', () => {
      if (!bridgeStarted && !shuttingDown) {
        startBridge('');
      }
    });
  } catch (err) {
    console.warn(
      `[warn] Could not initialize Cloudflare tunnel (${err instanceof Error ? err.message : 'error'}) — starting in Local LAN mode.`,
    );
    startBridge('');
  }
}

void main();
