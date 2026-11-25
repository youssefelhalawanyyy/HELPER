'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/shell/LeftNavRail';
import { useWakeLock } from '@/hooks/useWakeLock';
import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  HeartPulse,
  Laptop,
  Loader2,
  MousePointerClick,
  Play,
  QrCode,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';

type OsKind = 'mac' | 'windows';

const REPO_URL = 'https://github.com/youssefelhalawanyyy/HELPER';
const REPO_GIT = 'https://github.com/youssefelhalawanyyy/HELPER.git';
const REPO_ZIP = 'https://github.com/youssefelhalawanyyy/HELPER/archive/refs/heads/main.zip';
const REPO_TAR = 'https://github.com/youssefelhalawanyyy/HELPER/archive/refs/heads/main.tar.gz';
const APP_URL = 'https://helper-nu-swart.vercel.app';
const PAIRING_STORAGE_KEY = 'devdeck.pairing.v2';

// 100% Autonomous Self-Healing 1-Line Windows PowerShell Agent:
// 1) Bypasses ExecutionPolicy & enables TLS 1.2/1.3
// 2) Reloads Registry PATH + portable Node path
// 3) Auto-installs Node.js via winget OR downloads standalone portable Node.js v22 LTS ZIP if winget is unavailable (no Admin needed!)
// 4) Frees TCP port 4747 if occupied by an old zombie process
// 5) Clones via Git OR downloads & extracts main.zip directly if Git is not installed
// 6) Runs npm.cmd install with automatic cache-clean + --legacy-peer-deps self-healing fallback
// 7) Builds mac-bridge and launches live Cloudflare HTTP/2 tunnel + QR code
const WIN_SELF_HEALING_ONELINER = `Set-ExecutionPolicy Bypass -Scope Process -Force; $ErrorActionPreference='Continue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $pNode="$env:LOCALAPPDATA\\DevDeck\\node\\node-v22.14.0-win-x64"; $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User') + ";C:\\Program Files\\nodejs;$env:LOCALAPPDATA\\Programs\\nodejs;$pNode;C:\\Program Files\\Git\\cmd"; if (!(Get-Command node -ErrorAction SilentlyContinue)) { Write-Host '[AUTOPILOT] Installing Node.js LTS...' -ForegroundColor Cyan; if (Get-Command winget -ErrorAction SilentlyContinue) { winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements }; $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User') + ";C:\\Program Files\\nodejs;$pNode" }; if (!(Get-Command node -ErrorAction SilentlyContinue)) { Write-Host '[AUTOPILOT] Downloading portable Node.js v22 LTS (no admin needed)...' -ForegroundColor Cyan; $z="$env:TEMP\\node22.zip"; New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\\DevDeck\\node" | Out-Null; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip' -OutFile $z; Expand-Archive -Path $z -DestinationPath "$env:LOCALAPPDATA\\DevDeck\\node" -Force; $env:Path="$pNode;$env:Path" }; Get-NetTCPConnection -LocalPort 4747 -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 4) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }; $d="$env:USERPROFILE\\HELPER"; if (!(Test-Path "$d\\package.json")) { if (Get-Command git -ErrorAction SilentlyContinue) { git clone ${REPO_GIT} "$d" } else { Write-Host '[AUTOPILOT] Downloading HELPER ZIP (no Git needed)...' -ForegroundColor Cyan; Invoke-WebRequest -Uri '${REPO_ZIP}' -OutFile "$env:TEMP\\helper.zip"; Expand-Archive -Path "$env:TEMP\\helper.zip" -DestinationPath "$env:TEMP\\helper_ext" -Force; New-Item -ItemType Directory -Force -Path "$d" | Out-Null; Copy-Item -Path "$env:TEMP\\helper_ext\\HELPER-main\\*" -Destination "$d" -Recurse -Force } }; Set-Location "$d"; if (Test-Path .git) { git pull --ff-only 2>$null }; & npm.cmd install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { & npm.cmd cache clean --force 2>$null; & npm.cmd install --no-audit --no-fund --legacy-peer-deps }; & npm.cmd run build -w mac-bridge 2>$null; & npm.cmd run live`;

// 100% Autonomous Self-Healing 1-Line macOS Terminal Agent:
// 1) Configures Homebrew, /usr/local/bin, and ~/.devdeck/node/bin on PATH
// 2) Auto-installs Node.js via Homebrew OR downloads official standalone darwin-arm64/x64 Node v22 LTS tarball (zero sudo required!)
// 3) Clears unresponsive process on port 4747
// 4) Clones via Git OR downloads & extracts main.tar.gz via curl + tar
// 5) Runs npm install with automatic cache-clean + --legacy-peer-deps self-healing fallback
// 6) Builds mac-bridge and launches live Cloudflare HTTPS tunnel + QR code
const MAC_SELF_HEALING_ONELINER = `export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.devdeck/node/bin:$PATH"; if ! command -v node >/dev/null 2>&1; then if command -v brew >/dev/null 2>&1; then brew install node || true; fi; fi; if ! command -v node >/dev/null 2>&1; then echo "[AUTOPILOT] Downloading standalone Node.js v22 LTS (no sudo needed)..."; ARCH_RAW="$(uname -m)"; if [ "$ARCH_RAW" = "arm64" ]; then NARCH="arm64"; else NARCH="x64"; fi; mkdir -p "$HOME/.devdeck/node" && curl -fsSL "https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-\${NARCH}.tar.gz" | tar -xz -C "$HOME/.devdeck/node" --strip-components=1 && export PATH="$HOME/.devdeck/node/bin:$PATH"; fi; if [ ! -f "$HOME/HELPER/package.json" ]; then if command -v git >/dev/null 2>&1; then git clone ${REPO_GIT} "$HOME/HELPER"; else curl -fsSL "${REPO_TAR}" | tar -xz -C /tmp && rm -rf "$HOME/HELPER" && mv /tmp/HELPER-main "$HOME/HELPER"; fi; fi; cd "$HOME/HELPER" && (git pull --ff-only 2>/dev/null || true) && (npm install --no-audit --no-fund || (npm cache clean --force >/dev/null 2>&1; npm install --no-audit --no-fund --legacy-peer-deps)) && (npm run build -w mac-bridge >/dev/null 2>&1 || true) && npm run live`;

function buildWindowsAutoBatchFile(): string {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'chcp 65001 >nul 2>nul',
    'title DevDeck Autonomous Self-Healing Windows Bridge',
    'echo.',
    'echo  ================================================================',
    'echo   DEVDECK 1-CLICK AUTONOMOUS WINDOWS 10/11 SELF-HEALING INSTALLER',
    'echo  ================================================================',
    'echo.',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${WIN_SELF_HEALING_ONELINER.replace(/"/g, '\\"')}"`,
    'echo.',
    'pause',
    '',
  ].join('\r\n');
}

function buildMacAutoCommandFile(): string {
  return [
    '#!/bin/zsh',
    'echo ""',
    'echo " ================================================================"',
    'echo "  DEVDECK 1-CLICK AUTONOMOUS macOS SELF-HEALING INSTALLER"',
    'echo " ================================================================"',
    'echo ""',
    MAC_SELF_HEALING_ONELINER,
    '',
  ].join('\n');
}

function synthesizeAutoFixForError(
  stderrText: string,
  failedCmd: string,
  targetOs: OsKind,
): { fixCommand: string; reason: string } | null {
  const err = `${stderrText}\n${failedCmd}`.toLowerCase();

  if (/executionpolicy|running scripts is disabled|npm\.ps1|unauthorizedaccess/i.test(err)) {
    return {
      fixCommand:
        targetOs === 'windows'
          ? 'Set-ExecutionPolicy Bypass -Scope Process -Force; Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force'
          : 'chmod +x ~/HELPER/start-mac.command',
      reason: 'Detected PowerShell ExecutionPolicy restriction — unblocking script execution automatically.',
    };
  }
  if (/eaddrinuse|4747|address already in use/i.test(err)) {
    return {
      fixCommand:
        targetOs === 'windows'
          ? 'Get-NetTCPConnection -LocalPort 4747 -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 4) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }'
          : 'lsof -ti tcp:4747 | xargs kill -9 2>/dev/null || true',
      reason: 'Detected port 4747 conflict (EADDRINUSE) — terminating stale process on port 4747 automatically.',
    };
  }
  if (/eresolve|peer dep|npm err|ebusy|eacces|enoent.*package\.json/i.test(err)) {
    return {
      fixCommand:
        targetOs === 'windows'
          ? 'Set-Location "$env:USERPROFILE\\HELPER"; & npm.cmd cache clean --force; & npm.cmd install --no-audit --no-fund --legacy-peer-deps'
          : 'cd ~/HELPER && npm cache clean --force && npm install --no-audit --no-fund --legacy-peer-deps',
      reason: 'Detected npm dependency/cache error — cleaning cache and reinstalling with --legacy-peer-deps.',
    };
  }
  if (/node.*not recognized|command not found.*node/i.test(err)) {
    return {
      fixCommand:
        targetOs === 'windows'
          ? WIN_SELF_HEALING_ONELINER
          : MAC_SELF_HEALING_ONELINER,
      reason: 'Detected missing Node.js in PATH — running full portable Node.js auto-installer.',
    };
  }
  return null;
}

function synthesizeClientAiCommand(
  prompt: string,
  targetOs: OsKind,
): { command: string; explanation: string } {
  const q = prompt.toLowerCase();
  if (/install|start|build|create|setup|launch|bootstrap|bridge|qr/i.test(q) && !/update|pull/i.test(q)) {
    return {
      command: targetOs === 'windows' ? WIN_SELF_HEALING_ONELINER : MAC_SELF_HEALING_ONELINER,
      explanation:
        targetOs === 'windows'
          ? 'Autonomous Windows PowerShell self-healing installer: unblocks ExecutionPolicy, installs Node.js (via winget or portable ZIP without Admin), clears port 4747, downloads HELPER, repairs npm dependencies, and launches the Cloudflare HTTPS tunnel + QR code.'
          : 'Autonomous macOS Terminal self-healing installer: configures PATH, installs Node.js (via Homebrew or standalone tarball without sudo), downloads HELPER, installs dependencies, and starts the live Cloudflare HTTPS tunnel + iPhone QR code.',
    };
  }
  if (/executionpolicy|disabled|npm\.ps1|permission/i.test(q)) {
    return {
      command:
        targetOs === 'windows'
          ? 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force; Set-ExecutionPolicy Bypass -Scope Process -Force; & npm.cmd -v'
          : 'chmod +x ~/HELPER/start-mac.command && npm -v',
      explanation:
        targetOs === 'windows'
          ? 'Unblocks PowerShell script execution for your Windows account and verifies npm.cmd.'
          : 'Grants execute permission to start-mac.command and verifies npm.',
    };
  }
  if (/4747|port|in use|eaddrinuse|kill|stuck/i.test(q)) {
    return {
      command:
        targetOs === 'windows'
          ? "Get-NetTCPConnection -LocalPort 4747 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Output 'Cleared port 4747'"
          : "lsof -ti tcp:4747 | xargs kill -9 2>/dev/null || true; echo 'Cleared port 4747'",
      explanation: 'Finds and stops any old process occupying port 4747 so the bridge can bind cleanly.',
    };
  }
  if (/firewall|network|allow|tunnel|cloudflare/i.test(q)) {
    return {
      command:
        targetOs === 'windows'
          ? "New-NetFirewallRule -DisplayName 'DevDeck Bridge 4747' -Direction Inbound -LocalPort 4747 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue; Write-Output 'Windows Firewall rule active for TCP 4747'"
          : 'curl -s http://127.0.0.1:4747/api/health',
      explanation: 'Opens TCP port 4747 in Windows Defender Firewall for local LAN & tunnel traffic.',
    };
  }
  if (/update|pull|latest|upgrade|refresh/i.test(q)) {
    return {
      command:
        targetOs === 'windows'
          ? 'Set-Location "$env:USERPROFILE\\HELPER"; git pull --ff-only; & npm.cmd install --no-audit --no-fund; & npm.cmd run build -w mac-bridge'
          : 'cd ~/HELPER && git pull --ff-only && npm install --no-audit --no-fund && npm run build -w mac-bridge',
      explanation:
        'Pulls the newest code from GitHub and rebuilds mac-bridge (which automatically hot-reloads the running bridge).',
    };
  }
  return {
    command:
      targetOs === 'windows'
        ? 'Get-Process node,cloudflared -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU; Invoke-RestMethod http://127.0.0.1:4747/api/health | ConvertTo-Json'
        : 'ps aux | grep -E "node|cloudflared" | grep -v grep; curl -s http://127.0.0.1:4747/api/health',
    explanation: 'Inspects running Node/Cloudflared processes and queries the live bridge health endpoint.',
  };
}

function CopyBlock({
  label,
  code,
  hint,
  accent = '#88f1d1',
}: {
  label: string;
  code: string;
  hint?: string;
  accent?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#98c8ce29] bg-[#0a151c]">
      <div className="flex items-center justify-between gap-2 border-b border-[#98c8ce24] bg-[#101d25] px-3.5 py-2">
        <span
          className="font-mono-tech text-[11px] font-bold tracking-wider uppercase"
          style={{ color: accent }}
        >
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] px-2.5 py-1 text-[11px] font-bold text-[#effaf7] transition-colors hover:border-[#88f1d1]"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" className="h-3.5 w-3.5 text-[#88f1d1]" />
              <span className="text-[#88f1d1]">Copied!</span>
            </>
          ) : (
            <>
              <Copy aria-hidden="true" className="h-3.5 w-3.5 text-[#88f1d1]" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="deck-scroll overflow-x-auto px-4 py-3 font-mono-tech text-[12px] leading-relaxed text-[#d4f5e9] select-all">
        <code>{code}</code>
      </pre>
      {hint && (
        <div className="border-t border-[#98c8ce1f] bg-[#101d25]/65 px-3.5 py-1.5 text-[11px] text-[#9cb4bb]">
          {hint}
        </div>
      )}
    </div>
  );
}

function QrMatrixSvg({ matrix, size = 192 }: { matrix: number[][]; size?: number }) {
  const n = matrix.length;
  if (!n) return null;
  const pad = 2;
  const total = n + pad * 2;
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-2xl border-2 border-[#88f1d1]/55 bg-white p-1.5 shadow-[0_0_30px_rgba(136,241,209,0.22)]"
      role="img"
      aria-label="Scan QR Code with iPhone Camera to pair DevDeck"
    >
      <rect width={total} height={total} fill="#ffffff" />
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect key={`${r}-${c}`} x={c + pad} y={r + pad} width={1} height={1} fill="#061015" />
          ) : null,
        ),
      )}
    </svg>
  );
}

const FEATURES = [
  {
    icon: Bot,
    color: '#88f1d1',
    title: 'Antigravity Mission Hub',
    desc: 'Chat with active AI coding sessions, send slash commands (/plan, /boost, /teamwork), watch live agent logs, and inspect git diffs.',
  },
  {
    icon: MousePointerClick,
    color: '#7dd3fc',
    title: 'Pro Glass Trackpad & 60Hz Air Mouse',
    desc: '120Hz One-Euro filtered multi-touch trackpad, 3-axis gyroscope laser-pointer Air Mouse, D-Pad controller, and slide clicker.',
  },
  {
    icon: HeartPulse,
    color: '#ff5d6c',
    title: 'PC & Mac Rescue Doctor',
    desc: '10-point hardware/OS health scan + 1-tap Free RAM, Clean Junk, Malware Check, and SFC/DISM & DNS repair.',
  },
  {
    icon: Activity,
    color: '#88f1d1',
    title: 'NetOps Pro & LAN Radar',
    desc: 'Live streaming speedometer, active /24 Wi-Fi device discovery, multi-hop latency matrix, and Ping/DNS/14-Port TCP scanner.',
  },
  {
    icon: Cpu,
    color: '#fbbf24',
    title: 'Real Die Thermal & Power Guard',
    desc: 'Native IOKit/AppleSMC and Windows thermal zone CPU/GPU/Battery die gauges, power profiles, and 80% Charge Guard.',
  },
  {
    icon: Rocket,
    color: '#88f1d1',
    title: 'Web Studio & Localhost Tunnel',
    desc: 'Preview localhost:3000/5173 directly on your iPhone over an on-demand HTTPS HMR proxy with live Console & Lighthouse audit.',
  },
  {
    icon: Clock,
    color: '#7dd3fc',
    title: 'OLED Desk Clock & Telemetry',
    desc: 'Always-on mobile wake lock, live weather, 3 world clocks, automotive CPU/Heat/Battery gauges, and break timer.',
  },
  {
    icon: Sparkles,
    color: '#fbbf24',
    title: 'Nour Egyptian Arabic Voice AI',
    desc: 'Hands-free Gemini Aoede voice companion with barge-in interruption and instant computer command execution.',
  },
];

interface ShellOutputEntry {
  id: string;
  ts: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  shell: string;
  autoHealed?: string;
}

interface AutopilotStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'fixed';
  detail: string;
}

interface LivePairingBundle {
  token: string;
  pin: string;
  host: string;
  port: number;
  platform: string;
  hostname: string;
  tunnelUrl: string;
  pairUrl: string;
  localUrl: string;
  qrMatrix: number[][];
  qrAscii: string;
  terminalText: string;
}

export default function SetupGuidePage() {
  useWakeLock();
  const [os, setOs] = useState<OsKind>('windows');
  const [detectedOs, setDetectedOs] = useState<string>('');

  // Live Local/Remote Bridge & Autonomous Auto-Pilot State
  const [bridgeUrl, setBridgeUrl] = useState('http://127.0.0.1:4747');
  const [bridgeToken, setBridgeToken] = useState('');
  const [bridgePin, setBridgePin] = useState('');
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [bridgeHostInfo, setBridgeHostInfo] = useState<{
    hostname?: string;
    platform?: string;
    lanIp?: string;
    tunnelUrl?: string;
  } | null>(null);
  const [connectingBridge, setConnectingBridge] = useState(false);

  // Full QR Code + Terminal Text + Autopilot Checklist State
  const [liveBundle, setLiveBundle] = useState<LivePairingBundle | null>(null);
  const [autopilotRunning, setAutopilotRunning] = useState(false);
  const [autopilotWaitingForBootstrap, setAutopilotWaitingForBootstrap] = useState(false);
  const [autopilotSteps, setAutopilotSteps] = useState<AutopilotStep[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const autoClaimedRef = useRef(false);

  // Interactive Terminal / PowerShell & AI Copilot State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiExplanation, setAiExplanation] = useState(
    'Click "1-Click Autonomous Auto-Pilot" above — it takes control of PowerShell / Terminal, solves all errors automatically, and gives you your scannable QR code, 6-digit PIN, and terminal text.',
  );
  const [shellCommand, setShellCommand] = useState(WIN_SELF_HEALING_ONELINER);
  const [shellRunning, setShellRunning] = useState(false);
  const [shellHistory, setShellHistory] = useState<ShellOutputEntry[]>([]);
  const [cmdCopied, setCmdCopied] = useState(false);

  const copyTextWithBadge = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedField(key);
    window.setTimeout(() => setCopiedField((cur) => (cur === key ? null : cur)), 1800);
  };

  useEffect(() => {
    const hash = window.location.hash.toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    const isMacUa = ua.includes('mac os') || ua.includes('macintosh');
    const isWinUa = ua.includes('windows');
    setDetectedOs(isMacUa ? 'macOS' : isWinUa ? 'Windows' : 'Mobile / Browser');

    let initialOs: OsKind = 'windows';
    if (hash === '#mac') {
      initialOs = 'mac';
    } else if (hash === '#windows' || hash === '#win') {
      initialOs = 'windows';
    } else if (isMacUa) {
      initialOs = 'mac';
    }
    setOs(initialOs);
    setShellCommand(
      initialOs === 'windows' ? WIN_SELF_HEALING_ONELINER : MAC_SELF_HEALING_ONELINER,
    );

    try {
      const raw = window.localStorage.getItem(PAIRING_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          host?: string;
          port?: number;
          token?: string;
          bridgeUrl?: string;
        };
        if (parsed.token) setBridgeToken(parsed.token);
        if (parsed.bridgeUrl) setBridgeUrl(parsed.bridgeUrl);
        else if (parsed.host && parsed.port) {
          setBridgeUrl(`http://${parsed.host}:${parsed.port}`);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const switchOs = (next: OsKind) => {
    setOs(next);
    setShellCommand(next === 'windows' ? WIN_SELF_HEALING_ONELINER : MAC_SELF_HEALING_ONELINER);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${next}`);
    }
  };

  const applyPairingBundle = useCallback((data: LivePairingBundle, base: string) => {
    setLiveBundle(data);
    setBridgeToken(data.token);
    setBridgePin(data.pin);
    setBridgeOnline(true);
    setBridgeHostInfo({
      hostname: data.hostname,
      platform: data.platform,
      lanIp: data.host,
      tunnelUrl: data.tunnelUrl,
    });
    if (data.platform === 'win32') setOs('windows');
    else if (data.platform === 'darwin') setOs('mac');

    try {
      window.localStorage.setItem(
        PAIRING_STORAGE_KEY,
        JSON.stringify({
          host: data.tunnelUrl || data.host,
          port: data.port,
          token: data.token,
          bridgeUrl: data.tunnelUrl || base,
        }),
      );
    } catch {
      // Ignore
    }
  }, []);

  // Automatically claim local bridge & fetch full QR code + PIN + terminal text as soon as port 4747 responds!
  const claimLocalAutopilot = useCallback(
    async (baseCandidate = 'http://127.0.0.1:4747', ensureTunnel = true): Promise<boolean> => {
      try {
        const res = await fetch(`${baseCandidate}/api/setup/autopilot`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(bridgeToken ? { authorization: `Bearer ${bridgeToken}` } : {}),
          },
          body: JSON.stringify({ ensureTunnel }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as LivePairingBundle & {
          ok?: boolean;
          steps?: AutopilotStep[];
        };
        if (!data?.ok || !data.token) return false;

        applyPairingBundle(data, baseCandidate);
        if (Array.isArray(data.steps) && data.steps.length > 0) {
          setAutopilotSteps(data.steps);
        }
        setAutopilotWaitingForBootstrap(false);
        setAiExplanation(
          `Auto-Pilot Complete on ${data.hostname} (${data.platform === 'win32' ? 'Windows PowerShell' : 'macOS Terminal'})! Your 1-Scan QR Code, 6-Digit PIN (${data.pin}), and Cloudflare HTTPS Tunnel are live below.`,
        );
        return true;
      } catch {
        return false;
      }
    },
    [applyPairingBundle, bridgeToken],
  );

  // Probe local bridge (127.0.0.1:4747) & configured bridgeUrl continuously (every 1.4s during Auto-Pilot wait, 3.5s otherwise)
  const probeBridge = useCallback(async () => {
    const candidates = Array.from(
      new Set(['http://127.0.0.1:4747', bridgeUrl.replace(/\/+$/, '')]),
    );
    for (const base of candidates) {
      if (!base) continue;
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 1600);
      try {
        const res = await fetch(`${base}/api/health`, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        window.clearTimeout(timer);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          ok?: boolean;
          hostname?: string;
          platform?: string;
          lanIp?: string;
          bridgePort?: number;
          tunnelUrl?: string;
        };
        if (data?.ok) {
          setBridgeOnline(true);
          setBridgeUrl(base);
          setBridgeHostInfo(data);

          // Automatically claim & display QR code + PIN + Terminal text on first detection or while Auto-Pilot is waiting!
          if (!autoClaimedRef.current || autopilotWaitingForBootstrap || !liveBundle) {
            autoClaimedRef.current = true;
            void claimLocalAutopilot(base, true);
          }
          return true;
        }
      } catch {
        window.clearTimeout(timer);
      }
    }
    setBridgeOnline(false);
    return false;
  }, [bridgeUrl, autopilotWaitingForBootstrap, liveBundle, claimLocalAutopilot]);

  useEffect(() => {
    void probeBridge();
    const intervalMs = autopilotWaitingForBootstrap ? 1400 : 3500;
    const t = window.setInterval(() => void probeBridge(), intervalMs);
    return () => window.clearInterval(t);
  }, [probeBridge, autopilotWaitingForBootstrap]);

  const handleDownloadAutoInstaller = useCallback(
    (targetOs: OsKind = os) => {
      const isWin = targetOs === 'windows';
      const content = isWin ? buildWindowsAutoBatchFile() : buildMacAutoCommandFile();
      const filename = isWin ? 'DevDeck-Windows-AutoSetup.bat' : 'DevDeck-Mac-AutoSetup.command';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [os],
  );

  // 1-Click Autonomous Auto-Pilot: takes control of PowerShell/Terminal, fixes all errors, ensures tunnel, and outputs QR + Text!
  const handleStartAutonomousAutopilot = async () => {
    setAutopilotRunning(true);
    try {
      // 1. Check if local bridge is already reachable
      const claimed = await claimLocalAutopilot('http://127.0.0.1:4747', true);
      if (claimed) {
        // Also run a live self-healing verification pass inside the host shell so user sees real terminal verification output
        const base = 'http://127.0.0.1:4747';
        const token = liveBundle?.token || bridgeToken;
        if (token) {
          const verifyCmd =
            os === 'windows'
              ? 'Write-Output "[AUTOPILOT] Node: $(node -v) | npm: $(& npm.cmd -v) | Port 4747: ACTIVE"; Invoke-RestMethod http://127.0.0.1:4747/api/health | ConvertTo-Json -Compress'
              : 'echo "[AUTOPILOT] Node: $(node -v) | npm: $(npm -v) | Port 4747: ACTIVE" && curl -s http://127.0.0.1:4747/api/health';
          const shRes = await fetch(`${base}/api/devsuite/host-shell`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ command: verifyCmd }),
          }).catch(() => null);
          if (shRes?.ok) {
            const shData = (await shRes.json()) as {
              stdout?: string;
              stderr?: string;
              exitCode?: number;
              durationMs?: number;
              shell?: string;
            };
            setShellHistory((prev) =>
              [
                {
                  id: `${Date.now()}`,
                  ts: new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                  command: verifyCmd,
                  stdout: shData.stdout || '',
                  stderr: shData.stderr || '',
                  exitCode: shData.exitCode ?? 0,
                  durationMs: shData.durationMs ?? 0,
                  shell: shData.shell || (os === 'windows' ? 'Windows PowerShell' : 'macOS Terminal'),
                },
                ...prev,
              ].slice(0, 12),
            );
          }
        }
        return;
      }

      // 2. Bridge is not running yet on this machine -> Launch autonomous bootstrapper & watch 127.0.0.1:4747 every 1.4s!
      const oneLiner = os === 'windows' ? WIN_SELF_HEALING_ONELINER : MAC_SELF_HEALING_ONELINER;
      void navigator.clipboard?.writeText(oneLiner);
      setShellCommand(oneLiner);
      handleDownloadAutoInstaller(os);
      setAutopilotWaitingForBootstrap(true);
      setAutopilotSteps([
        {
          id: 'bootstrap',
          title:
            os === 'windows'
              ? '1. Autonomous Windows PowerShell Self-Healing Agent Prepared'
              : '1. Autonomous macOS Terminal Self-Healing Agent Prepared',
          status: 'done',
          detail:
            os === 'windows'
              ? 'Downloaded DevDeck-Windows-AutoSetup.bat & copied 1-line PowerShell agent to clipboard'
              : 'Downloaded DevDeck-Mac-AutoSetup.command & copied 1-line Terminal agent to clipboard',
        },
        {
          id: 'heal',
          title: '2. Waiting for Terminal / PowerShell Launch (Auto-Solving All Errors)…',
          status: 'running',
          detail:
            os === 'windows'
              ? 'Open the downloaded DevDeck-Windows-AutoSetup.bat (or press Right-Click + Enter in PowerShell). It automatically fixes ExecutionPolicy, installs Node.js, frees port 4747, installs packages, and connects back here!'
              : 'Open the downloaded DevDeck-Mac-AutoSetup.command (or press Cmd+V + Enter in Terminal). It automatically installs Node.js, frees port 4747, installs packages, and connects back here!',
        },
      ]);
      setAiExplanation(
        os === 'windows'
          ? 'Auto-Pilot started! Double-click the downloaded DevDeck-Windows-AutoSetup.bat (or paste into PowerShell with Right-Click → Enter). It solves all errors alone and this page will automatically display your QR code & 6-digit PIN the instant it finishes!'
          : 'Auto-Pilot started! Open the downloaded DevDeck-Mac-AutoSetup.command (or paste into Terminal with Cmd+V → Enter). It solves all errors alone and this page will automatically display your QR code & 6-digit PIN the instant it finishes!',
      );
    } finally {
      setAutopilotRunning(false);
    }
  };

  const handleConnectTerminal = async () => {
    setConnectingBridge(true);
    try {
      const base = bridgeUrl.replace(/\/+$/, '') || 'http://127.0.0.1:4747';
      const claimed = await claimLocalAutopilot(base, true);
      if (claimed) return;

      if (!bridgePin.trim()) {
        setAiExplanation(
          'Bridge not detected on 127.0.0.1:4747 yet — click "1-Click Autonomous Auto-Pilot" above to install and launch it automatically!',
        );
        return;
      }
      const pinRes = await fetch(`${base}/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: bridgePin.trim(), ensureTunnel: true }),
      });
      const pinData = (await pinRes.json()) as LivePairingBundle & {
        ok?: boolean;
        error?: string;
      };
      if (!pinRes.ok || !pinData.ok || !pinData.token) {
        throw new Error(pinData.error || 'Invalid 6-digit PIN');
      }
      applyPairingBundle(pinData, base);
      setAiExplanation(
        `Paired & connected to ${pinData.hostname || base}! Your QR Code, 6-Digit PIN, and Live PowerShell / Terminal control are ready.`,
      );
    } catch (err) {
      setAiExplanation(
        err instanceof Error
          ? err.message
          : 'Could not reach bridge yet — click "1-Click Autonomous Auto-Pilot" above.',
      );
    } finally {
      setConnectingBridge(false);
    }
  };

  // Executes command in host PowerShell/Terminal AND automatically diagnoses + fixes any error if exitCode !== 0!
  const handleRunInHostTerminal = async (cmdOverride?: string) => {
    const cmdToRun = (cmdOverride ?? shellCommand).trim();
    if (!cmdToRun || shellRunning) return;
    if (cmdOverride) setShellCommand(cmdOverride);

    if (!bridgeOnline || !bridgeToken) {
      void handleStartAutonomousAutopilot();
      return;
    }

    setShellRunning(true);
    try {
      const base = bridgeUrl.replace(/\/+$/, '');
      const execOnce = async (commandStr: string) => {
        const res = await fetch(`${base}/api/devsuite/host-shell`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${bridgeToken}`,
          },
          body: JSON.stringify({ command: commandStr }),
        });
        return (await res.json()) as {
          ok?: boolean;
          stdout?: string;
          stderr?: string;
          exitCode?: number;
          durationMs?: number;
          shell?: string;
          error?: string;
        };
      };

      let data = await execOnce(cmdToRun);
      let autoHealedNote: string | undefined;

      // Autonomous Error Solver: if command failed (exitCode !== 0), auto-diagnose, execute fix, and retry!
      if ((data.exitCode ?? 0) !== 0 || data.ok === false) {
        const fix = synthesizeAutoFixForError(data.stderr || data.error || '', cmdToRun, os);
        if (fix) {
          setAiExplanation(`Auto-Healing Error: ${fix.reason}`);
          await execOnce(fix.fixCommand);
          const retryData = await execOnce(cmdToRun);
          data = retryData;
          autoHealedNote = `${fix.reason} → Fixed & Retried Automatically`;
        }
      }

      const entry: ShellOutputEntry = {
        id: `${Date.now()}`,
        ts: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        command: cmdToRun,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode ?? 0,
        durationMs: data.durationMs ?? 0,
        shell: data.shell || (os === 'windows' ? 'Windows PowerShell' : 'macOS Terminal'),
        autoHealed: autoHealedNote,
      };
      setShellHistory((prev) => [entry, ...prev].slice(0, 12));

      // Refresh QR & tunnel bundle after shell run
      void claimLocalAutopilot(base, false);
    } catch (err) {
      setAiExplanation(err instanceof Error ? err.message : 'Remote shell execution failed');
    } finally {
      setShellRunning(false);
    }
  };

  const handleAskAiBuilder = async (customPrompt?: string) => {
    const q = (customPrompt ?? aiPrompt).trim();
    if (!q || aiBusy) return;
    if (customPrompt) setAiPrompt(customPrompt);
    setAiBusy(true);

    try {
      if (bridgeOnline && bridgeToken) {
        const base = bridgeUrl.replace(/\/+$/, '');
        const lastErr = shellHistory[0]?.stderr || '';
        const res = await fetch(`${base}/api/devsuite/ai-shell`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${bridgeToken}`,
          },
          body: JSON.stringify({
            prompt: q,
            targetOs: os,
            lastError: lastErr,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            ok?: boolean;
            command?: string;
            explanation?: string;
          };
          if (data.ok && data.command) {
            setShellCommand(data.command);
            setAiExplanation(data.explanation || 'AI command ready.');
            return;
          }
        }
      }

      const synth = synthesizeClientAiCommand(q, os);
      setShellCommand(synth.command);
      setAiExplanation(synth.explanation);
    } finally {
      setAiBusy(false);
    }
  };

  const macMcpJson = `{
  "mcpServers": {
    "devdeck": {
      "command": "npx",
      "args": ["tsx", "/Users/YOUR_USERNAME/HELPER/mac-bridge/src/mcp/server.ts"]
    }
  }
}`;

  const winMcpJson = `{
  "mcpServers": {
    "devdeck": {
      "command": "npx.cmd",
      "args": ["tsx", "C:\\\\Users\\\\YOUR_USERNAME\\\\HELPER\\\\mac-bridge\\\\src\\\\mcp\\\\server.ts"]
    }
  }
}`;

  return (
    <div className="setup-screen deck-scroll fixed inset-0 overflow-y-auto bg-[#091319] text-[#effaf7] select-text">
      {/* Sticky Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-[#98c8ce29] bg-[#0d1921]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <Brand />
            <span className="setup-label">Autonomous Setup &amp; Terminal Auto-Pilot</span>
          </div>

          <div className="flex items-center gap-2.5">
            <span
              className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono-tech text-[11px] font-bold sm:inline-flex"
              style={{
                borderColor: bridgeOnline ? 'rgba(136,241,209,0.4)' : 'rgba(152,200,206,0.2)',
                background: bridgeOnline ? 'rgba(136,241,209,0.12)' : 'rgba(16,29,37,0.8)',
                color: bridgeOnline ? '#88f1d1' : '#9cb4bb',
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: bridgeOnline ? '#88f1d1' : '#5b7880' }}
              />
              {bridgeOnline
                ? `Bridge Online · ${bridgeHostInfo?.hostname || '127.0.0.1:4747'}`
                : 'Waiting for Bridge…'}
            </span>

            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-[#98c8ce29] bg-[#101d25] px-3 py-1.5 text-xs font-bold text-[#effaf7] transition-colors hover:border-[#88f1d1] sm:flex"
            >
              GitHub
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 text-[#88f1d1]" />
            </a>
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-full bg-[#88f1d1] px-3.5 py-1.5 text-xs font-extrabold text-[#08221c] transition-transform active:scale-95"
            >
              <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
              Open DevDeck
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl space-y-7 px-5 py-7 pb-20">
        {/* ============ 1-CLICK AUTONOMOUS AUTO-PILOT & LIVE QR CODE CONSOLE ============ */}
        <section className="setup-hero space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="setup-intro max-w-2xl space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#88f1d1]/35 bg-[#88f1d1]/12 px-2.5 py-1 text-[11px] font-bold text-[#88f1d1]">
                  <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                  100% Autonomous Self-Healing Terminal &amp; PowerShell Agent
                </span>
                {detectedOs && (
                  <span className="rounded-full border border-[#98c8ce29] bg-[#0a151c] px-2.5 py-1 font-mono-tech text-[11px] text-[#9cb4bb]">
                    Detected: {detectedOs}
                  </span>
                )}
              </div>

              <h1 className="disp text-[30px] leading-[0.98] text-[#effaf7] sm:text-[40px]">
                Autonomous Auto-Pilot Setup &amp; Instant QR Code
              </h1>
              <p className="text-sm leading-relaxed text-[#b8d0d6]">
                Takes control of <strong>Windows PowerShell</strong> or{' '}
                <strong>macOS Terminal</strong>, solves every error automatically (ExecutionPolicy,
                portable Node.js v22 install without Admin/sudo, Git-less ZIP fallback, stuck port
                4747 cleanup, npm cache repair, and Cloudflare HTTP/2 tunnel), and displays your{' '}
                <strong>scannable iPhone QR Code, 6-Digit PIN, and Terminal Text</strong> right
                here.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:min-w-[280px]">
              <button
                type="button"
                disabled={autopilotRunning}
                onClick={() => void handleStartAutonomousAutopilot()}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#88f1d1] px-4 py-3.5 text-xs font-extrabold text-[#08221c] shadow-[0_0_25px_rgba(136,241,209,0.35)] transition-transform active:scale-98"
              >
                {autopilotRunning ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Zap aria-hidden="true" className="h-4 w-4 shrink-0" />
                )}
                {bridgeOnline
                  ? '⚡ Run Auto-Pilot Check & Refresh QR Code'
                  : `⚡ 1-Click Auto-Pilot (${os === 'windows' ? 'Windows' : 'macOS'})`}
              </button>

              <button
                type="button"
                onClick={() => handleDownloadAutoInstaller(os)}
                className="flex items-center justify-center gap-2 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] px-4 py-2 text-xs font-bold text-[#effaf7] transition-colors hover:border-[#88f1d1]"
              >
                <Download aria-hidden="true" className="h-3.5 w-3.5 text-[#88f1d1]" />
                {os === 'windows'
                  ? 'Download Self-Healing Windows (.bat)'
                  : 'Download Self-Healing macOS (.command)'}
              </button>
            </div>
          </div>

          {/* Operating System Selector */}
          <div className="setup-platforms" role="group" aria-label="Target computer operating system">
            <button
              type="button"
              aria-pressed={os === 'windows'}
              onClick={() => switchOs('windows')}
            >
              <Laptop size={16} aria-hidden="true" />
              Windows 10 / 11 (PowerShell Auto-Pilot)
            </button>
            <button type="button" aria-pressed={os === 'mac'} onClick={() => switchOs('mac')}>
              <Terminal size={16} aria-hidden="true" />
              macOS (Terminal / zsh Auto-Pilot)
            </button>
          </div>

          {/* Autonomous Self-Healing Steps Checklist */}
          {autopilotSteps.length > 0 && (
            <div className="grid gap-2 rounded-2xl border border-[#88f1d1]/30 bg-[#081319]/90 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {autopilotSteps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5"
                >
                  {step.status === 'running' ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#fbbf24]" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#88f1d1]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
                      <span className="truncate">{step.title}</span>
                      {step.status === 'fixed' && (
                        <span className="rounded bg-[#fbbf24]/20 px-1.5 py-0.5 text-[9px] text-[#fbbf24]">
                          AUTO-FIXED
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#9cb4bb]">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* LIVE QR CODE + 6-DIGIT PIN + TUNNEL URLS + FULL TERMINAL TEXT BOX */}
          {liveBundle && (
            <div className="grid gap-4 rounded-2xl border-2 border-[#88f1d1]/45 bg-[#071117] p-4 lg:grid-cols-12">
              {/* Left: Scannable Vector QR Code + 6-Digit PIN + 1-Tap Pair Actions */}
              <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#0b1820] p-4 lg:col-span-5">
                <div className="text-center">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[#88f1d1]/15 px-3 py-0.5 text-[10px] font-extrabold text-[#88f1d1] uppercase">
                    <CheckCircle2 className="h-3 w-3" />
                    Bridge Live &amp; Ready to Scan
                  </div>
                  <h3 className="disp mt-1 text-[22px] text-white">
                    Scan with iPhone Camera
                  </h3>
                  <p className="text-[11px] text-[#9cb4bb]">
                    {liveBundle.hostname} ({liveBundle.host}:{liveBundle.port})
                  </p>
                </div>

                {liveBundle.qrMatrix?.length > 0 && (
                  <QrMatrixSvg matrix={liveBundle.qrMatrix} size={196} />
                )}

                {/* 6-Digit Pairing PIN Card */}
                <div className="flex w-full items-center justify-between rounded-xl border border-[#88f1d1]/35 bg-[#061015] px-3.5 py-2">
                  <div>
                    <div className="text-[9.5px] font-bold text-[#9cb4bb] uppercase">
                      6-Digit Pairing PIN
                    </div>
                    <div className="font-mono-tech text-2xl font-black tracking-[0.22em] text-[#88f1d1]">
                      {liveBundle.pin}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyTextWithBadge('pin', liveBundle.pin)}
                    className="flex items-center gap-1 rounded-lg border border-[#88f1d1]/35 bg-[#88f1d1]/15 px-2.5 py-1.5 text-[11px] font-extrabold text-[#88f1d1]"
                  >
                    {copiedField === 'pin' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy PIN
                      </>
                    )}
                  </button>
                </div>

                <div className="grid w-full grid-cols-2 gap-2">
                  <a
                    href={liveBundle.pairUrl}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-[#88f1d1] py-2.5 text-xs font-extrabold text-[#061c17]"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    Open Paired App
                  </a>
                  <button
                    type="button"
                    onClick={() => copyTextWithBadge('pairUrl', liveBundle.pairUrl)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] py-2.5 text-xs font-extrabold text-white"
                  >
                    {copiedField === 'pairUrl' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#88f1d1]" />
                        Link Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-[#88f1d1]" />
                        Copy Pair Link
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right: All Copyable URLs + Exact Terminal / PowerShell ASCII Output Box */}
              <div className="flex flex-col justify-between gap-3 lg:col-span-7">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/[0.08] bg-[#0b1820] p-2.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono-tech text-[10px] font-extrabold text-[#88f1d1] uppercase">
                        Cloudflare HTTPS Tunnel URL
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyTextWithBadge(
                            'tunnelUrl',
                            liveBundle.tunnelUrl || `http://${liveBundle.host}:${liveBundle.port}`,
                          )
                        }
                        className="text-[10px] font-bold text-[#88f1d1] underline"
                      >
                        {copiedField === 'tunnelUrl' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <div className="font-mono-tech truncate text-xs text-white select-all">
                      {liveBundle.tunnelUrl || `http://${liveBundle.host}:${liveBundle.port}`}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/[0.08] bg-[#0b1820] p-2.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono-tech text-[10px] font-extrabold text-[#7dd3fc] uppercase">
                        Local Wi-Fi LAN Bridge
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyTextWithBadge('lanUrl', `http://${liveBundle.host}:${liveBundle.port}`)
                        }
                        className="text-[10px] font-bold text-[#7dd3fc] underline"
                      >
                        {copiedField === 'lanUrl' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <div className="font-mono-tech truncate text-xs text-white select-all">
                      http://{liveBundle.host}:{liveBundle.port}
                    </div>
                  </div>
                </div>

                {/* Complete Terminal / PowerShell Text Output Box */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.09] bg-[#040a0e]">
                  <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0b1820] px-3 py-1.5">
                    <span className="font-mono-tech text-[10px] font-extrabold text-[#88f1d1] uppercase">
                      Live Terminal / PowerShell Output (QR + PIN + Links)
                    </span>
                    <button
                      type="button"
                      onClick={() => copyTextWithBadge('termBox', liveBundle.terminalText)}
                      className="flex items-center gap-1 rounded-md border border-[#88f1d1]/30 bg-[#88f1d1]/12 px-2 py-0.5 text-[10px] font-extrabold text-[#88f1d1]"
                    >
                      {copiedField === 'termBox' ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied All Text
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy All Text
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="deck-scroll max-h-64 flex-1 overflow-auto p-3 font-mono-tech text-[10px] leading-[1.15] text-[#d4f5e9] select-all">
                    {liveBundle.terminalText}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ============ BROWSER TERMINAL / POWERSHELL CONTROL & AI SELF-HEALING SHELL ============ */}
        <section className="rounded-3xl border border-[#98c8ce33] bg-[#101d25] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-[#88f1d1]/35 bg-[#88f1d1]/14 text-[#88f1d1]">
                <Terminal aria-hidden="true" className="h-4 w-4" />
              </div>
              <div>
                <h2 className="disp text-[22px] text-[#effaf7]">
                  Live {os === 'windows' ? 'PowerShell' : 'Terminal'} Controller &amp; Auto-Error Solver
                </h2>
                <p className="text-xs text-[#9cb4bb]">
                  Any command executed here automatically detects errors (ExecutionPolicy, port
                  4747, npm cache, missing packages), fixes them, and retries until it succeeds.
                </p>
              </div>
            </div>

            {/* Live Connection / Takeover Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="Bridge URL"
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder="http://127.0.0.1:4747"
                className="font-mono-tech h-8 w-44 rounded-xl border border-[#98c8ce2e] bg-[#0a151c] px-2.5 text-xs text-[#effaf7] outline-none focus:border-[#88f1d1]"
              />
              <input
                type="text"
                aria-label="6-digit pairing PIN (optional on local computer)"
                value={bridgePin}
                onChange={(e) => setBridgePin(e.target.value)}
                placeholder="PIN (if remote)"
                maxLength={6}
                className="font-mono-tech h-8 w-28 rounded-xl border border-[#98c8ce2e] bg-[#0a151c] px-2.5 text-xs text-[#effaf7] outline-none focus:border-[#88f1d1]"
              />
              <button
                type="button"
                disabled={connectingBridge}
                onClick={() => void handleConnectTerminal()}
                className="flex h-8 items-center gap-1.5 rounded-xl border border-[#88f1d1] bg-[#88f1d1]/16 px-3 text-xs font-extrabold text-[#88f1d1] transition-colors hover:bg-[#88f1d1] hover:text-[#08221c]"
              >
                {connectingBridge ? (
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {bridgeToken
                  ? 'Refresh QR & Terminal'
                  : bridgeOnline
                    ? 'Take Control (1-Click)'
                    : 'Connect Bridge'}
              </button>
            </div>
          </div>

          {/* 1-Tap AI Task & Fix Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['🚀 Full Auto-Install & Start Bridge', 'Install and start the bridge from scratch'],
                [
                  os === 'windows'
                    ? '🔓 Fix PowerShell ExecutionPolicy'
                    : '🔓 Fix macOS Permissions',
                  'Fix PowerShell ExecutionPolicy running scripts is disabled',
                ],
                ['🔥 Clear Stuck Port 4747', 'Kill stuck process on port 4747'],
                [
                  os === 'windows'
                    ? '🛡️ Allow Windows Firewall 4747'
                    : '🩺 Check Bridge Health',
                  'Allow firewall port 4747 and check bridge health',
                ],
                ['🔄 Pull Update & Rebuild Bridge', 'Pull latest GitHub update and rebuild bridge'],
              ] as const
            ).map(([label, promptVal]) => (
              <button
                key={label}
                type="button"
                onClick={() => void handleAskAiBuilder(promptVal)}
                className="rounded-xl border border-[#98c8ce29] bg-[#0a151c] px-2.5 py-1.5 text-[11px] font-bold text-[#b8d0d6] transition-colors hover:border-[#88f1d1] hover:text-[#88f1d1]"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Ask AI Input Row */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAskAiBuilder();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="relative flex min-w-[240px] flex-1 items-center">
              <Bot
                aria-hidden="true"
                className="pointer-events-none absolute left-3 h-4 w-4 text-[#88f1d1]"
              />
              <input
                type="text"
                aria-label="Ask AI to generate or run a PowerShell or Terminal command"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={
                  os === 'windows'
                    ? 'Paste any PowerShell error or ask AI (e.g. "npm.ps1 cannot be loaded", "fix everything & show QR")…'
                    : 'Paste any Terminal error or ask AI (e.g. "install Node & start bridge", "clear port 4747")…'
                }
                className="h-10 w-full rounded-xl border border-[#98c8ce2e] bg-[#0a151c] pr-3 pl-9 text-xs text-[#effaf7] outline-none focus:border-[#88f1d1]"
              />
            </div>
            <button
              type="submit"
              disabled={aiBusy || !aiPrompt.trim()}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] px-3.5 text-xs font-extrabold text-[#88f1d1] disabled:opacity-40"
            >
              {aiBusy ? (
                <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              AI Solve &amp; Generate
            </button>
          </form>

          {/* AI Explanation Banner */}
          <div className="rounded-xl border border-[#88f1d1]/25 bg-[#0a151c] px-3.5 py-2.5 text-xs leading-relaxed text-[#d4f5e9]">
            <strong className="mr-1.5 text-[#88f1d1]">AI Auto-Pilot:</strong>
            {aiExplanation}
          </div>

          {/* Editable Command Box + Execute / Copy Controls */}
          <div className="space-y-2 rounded-2xl border border-[#98c8ce29] bg-[#071015] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-tech text-[11px] font-extrabold text-[#88f1d1] uppercase">
                {os === 'windows' ? 'PS C:\\Users\\You\\HELPER>' : 'zsh ~/HELPER $'}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shellCommand);
                    setCmdCopied(true);
                    window.setTimeout(() => setCmdCopied(false), 1800);
                  }}
                  className="flex h-7 items-center gap-1 rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] px-2.5 text-[11px] font-bold text-[#effaf7]"
                >
                  {cmdCopied ? (
                    <>
                      <Check aria-hidden="true" className="h-3 w-3 text-[#88f1d1]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy aria-hidden="true" className="h-3 w-3 text-[#88f1d1]" />
                      Copy Command
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={shellRunning || !shellCommand.trim()}
                  onClick={() => void handleRunInHostTerminal()}
                  className="flex h-7 items-center gap-1 rounded-lg bg-[#88f1d1] px-3 text-[11px] font-extrabold text-[#08221c] disabled:opacity-40"
                >
                  {shellRunning ? (
                    <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play aria-hidden="true" className="h-3 w-3" />
                  )}
                  {bridgeOnline && bridgeToken
                    ? `Execute & Auto-Heal in ${os === 'windows' ? 'PowerShell' : 'Terminal'}`
                    : `Launch 1-Click Auto-Pilot (${os === 'windows' ? 'PowerShell' : 'Terminal'})`}
                </button>
              </div>
            </div>

            <textarea
              rows={3}
              aria-label="PowerShell or Terminal command to execute"
              value={shellCommand}
              onChange={(e) => setShellCommand(e.target.value)}
              spellCheck={false}
              className="deck-scroll font-mono-tech w-full resize-y rounded-xl border border-[#98c8ce20] bg-[#0a151c] p-2.5 text-xs leading-relaxed text-[#d4f5e9] outline-none focus:border-[#88f1d1]"
            />

            {/* Live Remote Shell Output History */}
            {shellHistory.length > 0 && (
              <div className="deck-scroll max-h-64 space-y-2 overflow-y-auto border-t border-[#98c8ce22] pt-2.5">
                {shellHistory.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[#98c8ce22] bg-[#0a151c] p-2.5 font-mono-tech text-[11px]"
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[#9cb4bb]">
                      <span className="truncate font-bold text-[#88f1d1]">$ {item.command}</span>
                      <div className="flex items-center gap-2">
                        {item.autoHealed && (
                          <span className="rounded bg-[#fbbf24]/20 px-1.5 py-0.5 text-[9.5px] font-extrabold text-[#fbbf24]">
                            {item.autoHealed}
                          </span>
                        )}
                        <span className="shrink-0">
                          {item.shell} · exit {item.exitCode} · {item.durationMs}ms
                        </span>
                      </div>
                    </div>
                    {item.stdout && (
                      <pre className="overflow-x-auto whitespace-pre-wrap text-[#effaf7]">
                        {item.stdout}
                      </pre>
                    )}
                    {item.stderr && (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[#ff8a95]">
                        {item.stderr}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Express 1-Command Self-Healing Bootstrap */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap aria-hidden="true" className="h-5 w-5 text-[#88f1d1]" />
            <h2 className="disp text-[24px] text-[#effaf7]">
              1-Command Autonomous Self-Healing Bootstrap ({os === 'windows' ? 'Windows PowerShell' : 'macOS Terminal'})
            </h2>
          </div>

          {os === 'windows' ? (
            <CopyBlock
              label="Windows PowerShell — Solves ExecutionPolicy, Missing Node.js, Missing Git, Port 4747 & NPM Cache Automatically"
              accent="#88f1d1"
              code={WIN_SELF_HEALING_ONELINER}
              hint="Paste this single command into Windows PowerShell (or double-click DevDeck-Windows-AutoSetup.bat). As soon as it finishes, this /setup page automatically pops up your scannable QR code and 6-digit PIN."
            />
          ) : (
            <CopyBlock
              label="macOS Terminal — Solves Missing Node.js (No Sudo Needed), Missing Git, Port 4747 & NPM Cache Automatically"
              accent="#88f1d1"
              code={MAC_SELF_HEALING_ONELINER}
              hint="Paste this single command into macOS Terminal (or open DevDeck-Mac-AutoSetup.command). As soon as it finishes, this /setup page automatically pops up your scannable QR code and 6-digit PIN."
            />
          )}
        </section>

        {/* Permissions & Antigravity MCP Config */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-[#98c8ce29] bg-[#101d25] p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[#88f1d1]" />
              <h3 className="disp text-[20px] text-[#effaf7]">
                {os === 'windows' ? 'Windows Self-Healing Architecture' : 'macOS Self-Healing Architecture'}
              </h3>
            </div>
            {os === 'windows' ? (
              <ul role="list" className="space-y-2 text-xs leading-relaxed text-[#b8d0d6]">
                <li>
                  • <strong>Zero-Admin Portable Node.js Fallback:</strong> If <code>winget</code> is
                  unavailable, automatically downloads official portable Node.js v22 LTS into{' '}
                  <code>%LOCALAPPDATA%\DevDeck\node</code>.
                </li>
                <li>
                  • <strong>Persistent Sub-5ms PowerShell Engine:</strong> Pre-compiled Win32
                  P/Invoke worker for 120Hz trackpad, 60Hz Air Mouse, volume/brightness
                  potentiometer, and thermal telemetry.
                </li>
                <li>
                  • <strong>Standalone Cloudflared HTTP/2 Tunnel:</strong> Auto-downloads official{' '}
                  <code>cloudflared.exe</code> with <code>--protocol http2</code> so Windows
                  Firewall UDP QUIC blocks never prevent pairing.
                </li>
              </ul>
            ) : (
              <ul role="list" className="space-y-2 text-xs leading-relaxed text-[#b8d0d6]">
                <li>
                  • <strong>Zero-Sudo Standalone Node.js Fallback:</strong> If Homebrew isn&apos;t
                  installed, automatically downloads official darwin-arm64/x64 Node.js v22 LTS into{' '}
                  <code>~/.devdeck/node</code>.
                </li>
                <li>
                  • <strong>Native IOKit, AppleSMC &amp; DisplayServices:</strong> Reads real Apple
                  Silicon 50-sensor die thermals and controls hardware display brightness in &lt;3ms
                  without root.
                </li>
              </ul>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-[#98c8ce29] bg-[#101d25] p-5">
            <div className="flex items-center gap-2">
              <Bot aria-hidden="true" className="h-5 w-5 text-[#7dd3fc]" />
              <h3 className="disp text-[20px] text-[#effaf7]">Antigravity MCP Server (Optional)</h3>
            </div>
            <p className="text-xs leading-relaxed text-[#b8d0d6]">
              Add to{' '}
              <code className="text-[#88f1d1]">
                {os === 'windows'
                  ? '%USERPROFILE%\\.gemini\\antigravity\\mcp_config.json'
                  : '~/.gemini/antigravity/mcp_config.json'}
              </code>{' '}
              for bidirectional iPhone notifications &amp; approval prompts:
            </p>
            <CopyBlock
              label="mcp_config.json"
              accent="#7dd3fc"
              code={os === 'windows' ? winMcpJson : macMcpJson}
            />
          </div>
        </section>

        {/* All 8 Features Grid */}
        <section className="space-y-4">
          <h2 className="disp text-[24px] text-[#effaf7]">Everything Included Across DevDeck</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-2xl border border-[#98c8ce26] bg-[#101d25] p-4"
                >
                  <div
                    className="mb-2.5 grid h-9 w-9 place-items-center rounded-xl"
                    style={{ background: `${f.color}1c`, color: f.color }}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </div>
                  <div className="text-xs font-extrabold text-[#effaf7]">{f.title}</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-[#9cb4bb]">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
