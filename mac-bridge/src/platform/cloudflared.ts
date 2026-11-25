import { type ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(__dirname, '../..');
const MONOREPO_ROOT = path.resolve(BRIDGE_ROOT, '..');
const BIN_DIR = path.join(BRIDGE_ROOT, 'data', 'bin');
const IS_WIN = process.platform === 'win32';

let cachedCloudflaredCmd: { cmd: string; prefixArgs: string[] } | null = null;
let provisioningPromise: Promise<{ cmd: string; prefixArgs: string[] }> | null = null;

function downloadFileWithRedirects(url: string, destPath: string, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'user-agent': 'DevDeck-Bridge/1.0' } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadFileWithRedirects(nextUrl, destPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed with HTTP ${res.statusCode ?? 0}`));
          return;
        }

        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const tmpPath = `${destPath}.download`;
        const out = fs.createWriteStream(tmpPath);
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
              fs.renameSync(tmpPath, destPath);
              if (!IS_WIN) fs.chmodSync(destPath, 0o755);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });
        out.on('error', (err) => {
          try {
            fs.unlinkSync(tmpPath);
          } catch {}
          reject(err);
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(45_000, () => {
      req.destroy(new Error('Download timed out'));
    });
  });
}

/**
 * Resolves a direct executable for `cloudflared` without ever invoking `npx.cmd` or `cmd.exe` on Windows.
 * On Windows, auto-downloads the official standalone `cloudflared.exe` into `mac-bridge/data/bin/` if not on PATH.
 */
export async function resolveCloudflaredCommand(logProgress = false): Promise<{
  cmd: string;
  prefixArgs: string[];
}> {
  if (cachedCloudflaredCmd) return cachedCloudflaredCmd;
  if (provisioningPromise) return provisioningPromise;

  provisioningPromise = (async () => {
    // 1. Check local cached binary in mac-bridge/data/bin/
    const localBin = path.join(BIN_DIR, IS_WIN ? 'cloudflared.exe' : 'cloudflared');
    if (fs.existsSync(localBin) && fs.statSync(localBin).size > 1_000_000) {
      cachedCloudflaredCmd = { cmd: localBin, prefixArgs: [] };
      return cachedCloudflaredCmd;
    }

    // 2. Check system PATH (`where.exe` on Windows, `which` on macOS/Linux)
    try {
      const locator = IS_WIN ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(locator, ['cloudflared'], {
        timeout: 2500,
        windowsHide: true,
      });
      const firstLine = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && (!IS_WIN || /\.exe$/i.test(l)));
      if (firstLine && fs.existsSync(firstLine)) {
        cachedCloudflaredCmd = { cmd: firstLine, prefixArgs: [] };
        return cachedCloudflaredCmd;
      }
    } catch {
      // Not installed globally yet
    }

    // 3. On Windows (or Linux), download standalone official Cloudflare binary directly (zero npx/cmd.exe issues!)
    if (IS_WIN) {
      const archAsset =
        process.arch === 'arm64'
          ? 'cloudflared-windows-arm64.exe'
          : process.arch === 'ia32'
            ? 'cloudflared-windows-386.exe'
            : 'cloudflared-windows-amd64.exe';
      const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${archAsset}`;
      if (logProgress) {
        console.log(`⬇️  First-run Windows setup: downloading official ${archAsset}...`);
      }
      await downloadFileWithRedirects(url, localBin);
      if (logProgress) {
        console.log('✅ cloudflared.exe ready (cached locally for instant future startups).\n');
      }
      cachedCloudflaredCmd = { cmd: localBin, prefixArgs: [] };
      return cachedCloudflaredCmd;
    }

    // 4. macOS / Linux fallback if Homebrew cloudflared isn't on PATH: use npx
    cachedCloudflaredCmd = { cmd: 'npx', prefixArgs: ['-y', 'cloudflared'] };
    return cachedCloudflaredCmd;
  })().finally(() => {
    provisioningPromise = null;
  });

  return provisioningPromise;
}

/**
 * Spawns a Cloudflare Quick Tunnel cleanly across Windows, macOS, and Linux.
 * Uses `--protocol http2` on Windows so Windows Defender Firewall UDP QUIC blocks never hang tunnel creation!
 */
export async function spawnCloudflaredQuickTunnel(
  targetHttpUrl: string,
  logProgress = false,
): Promise<ChildProcess> {
  const { cmd, prefixArgs } = await resolveCloudflaredCommand(logProgress);
  const tunnelArgs = [
    ...prefixArgs,
    'tunnel',
    ...(IS_WIN ? ['--protocol', 'http2'] : []),
    '--url',
    targetHttpUrl,
  ];
  return spawn(cmd, tunnelArgs, {
    cwd: BRIDGE_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/**
 * Resolves local `tsx` CLI entrypoint so we can spawn `process.execPath` (`node.exe`) directly with `shell: false`.
 */
export function resolveTsxCliMjs(): string | null {
  const candidates = [
    path.join(MONOREPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(BRIDGE_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Terminates a child process and all of its descendants cleanly (prevents orphan node.exe / cloudflared.exe on Windows).
 */
export function killChildProcessTree(child: ChildProcess | null | undefined): void {
  if (!child || child.killed) return;
  const pid = child.pid;
  if (IS_WIN && pid) {
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.unref();
      return;
    } catch {
      // Fallback to child.kill()
    }
  }
  try {
    child.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (!child.killed && child.exitCode === null) {
          child.kill('SIGKILL');
        }
      } catch {
        // Ignore
      }
    }, 450).unref();
  } catch {
    // Ignore already exited
  }
}
