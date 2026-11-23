import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '..');
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 4747);
const PUBLIC_PWA_URL = (process.env.PUBLIC_PWA_URL || 'https://helper-nu-swart.vercel.app').replace(/\/+$/, '');
const IS_WIN = process.platform === 'win32';
const NPX_CMD = IS_WIN ? 'npx.cmd' : 'npx';
const OS_LABEL = IS_WIN ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux';

let tunnelChild: ChildProcess | null = null;
let bridgeChild: ChildProcess | null = null;
let bridgeStarted = false;

console.log(`\n🚀 DevDeck Live Launcher (${OS_LABEL}) — starting free Cloudflare HTTPS tunnel...\n`);

tunnelChild = spawn(
  NPX_CMD,
  ['-y', 'cloudflared', 'tunnel', '--url', `http://127.0.0.1:${BRIDGE_PORT}`],
  {
    cwd: BRIDGE_ROOT,
    shell: IS_WIN,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

function startBridge(tunnelUrl: string): void {
  if (bridgeStarted) return;
  bridgeStarted = true;
  console.log(`\n✅ Tunnel live: ${tunnelUrl}`);
  console.log(`🔗 Starting DevDeck ${OS_LABEL} Bridge with 1-scan Vercel QR code...\n`);

  const distEntry = path.join(BRIDGE_ROOT, 'dist', 'index.js');
  const srcEntry = path.join(BRIDGE_ROOT, 'src', 'index.ts');
  const useCompiled =
    fs.existsSync(distEntry) &&
    (!fs.existsSync(srcEntry) || fs.statSync(distEntry).mtimeMs >= fs.statSync(srcEntry).mtimeMs);

  bridgeChild = useCompiled
    ? spawn(process.execPath, [distEntry], {
        cwd: BRIDGE_ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          BRIDGE_PORT: String(BRIDGE_PORT),
          PUBLIC_PWA_URL,
          PUBLIC_BRIDGE_URL: tunnelUrl,
        },
      })
    : spawn(NPX_CMD, ['tsx', 'src/index.ts'], {
        cwd: BRIDGE_ROOT,
        shell: IS_WIN,
        stdio: 'inherit',
        env: {
          ...process.env,
          BRIDGE_PORT: String(BRIDGE_PORT),
          PUBLIC_PWA_URL,
          PUBLIC_BRIDGE_URL: tunnelUrl,
        },
      });

  bridgeChild.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

function inspectChunk(chunk: Buffer): void {
  const text = chunk.toString('utf8');
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !bridgeStarted) {
    startBridge(match[0]);
  }
}

tunnelChild.stdout?.on('data', inspectChunk);
tunnelChild.stderr?.on('data', inspectChunk);

tunnelChild.on('error', (err) => {
  console.error('Failed to start cloudflared:', err.message);
  process.exit(1);
});

tunnelChild.on('exit', (code) => {
  if (!bridgeStarted) {
    console.error(`cloudflared exited before creating tunnel (code ${code ?? 'unknown'})`);
    process.exit(code ?? 1);
  }
});

function cleanup(): void {
  if (bridgeChild && !bridgeChild.killed) bridgeChild.kill('SIGTERM');
  if (tunnelChild && !tunnelChild.killed) tunnelChild.kill('SIGTERM');
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
