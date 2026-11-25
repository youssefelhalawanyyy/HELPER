'use client';

import { useCallback, useEffect, useState } from 'react';
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
  Send,
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

// Self-healing 1-line Windows PowerShell Bootstrap:
// - Bypasses ExecutionPolicy for the session so npm.ps1 is never blocked
// - Auto-installs Node.js LTS via winget if missing & reloads Registry PATH in the same window
// - Clones via git OR downloads & extracts main.zip directly if Git is not installed!
// - Pulls latest updates if folder already exists, installs deps via npm.cmd, and starts live tunnel
const WIN_SELF_HEALING_ONELINER = `Set-ExecutionPolicy Bypass -Scope Process -Force; $ErrorActionPreference='Continue'; $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User') + ';C:\\Program Files\\nodejs;C:\\Program Files\\Git\\cmd'; if (!(Get-Command node -ErrorAction SilentlyContinue)) { Write-Host '[DevDeck] Installing Node.js LTS via winget...' -ForegroundColor Cyan; winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements; $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User') + ';C:\\Program Files\\nodejs' }; $d="$env:USERPROFILE\\HELPER"; if (!(Test-Path "$d\\package.json")) { if (Get-Command git -ErrorAction SilentlyContinue) { git clone ${REPO_GIT} "$d" } else { Write-Host '[DevDeck] Downloading HELPER ZIP (no Git required)...' -ForegroundColor Cyan; Invoke-WebRequest -Uri '${REPO_ZIP}' -OutFile "$env:TEMP\\helper.zip"; Expand-Archive -Path "$env:TEMP\\helper.zip" -DestinationPath "$env:TEMP\\helper_ext" -Force; New-Item -ItemType Directory -Force -Path "$d" | Out-Null; Copy-Item -Path "$env:TEMP\\helper_ext\\HELPER-main\\*" -Destination "$d" -Recurse -Force } }; Set-Location "$d"; if (Test-Path .git) { git pull --ff-only 2>$null }; & npm.cmd install; & npm.cmd run live`;

// Self-healing 1-line macOS Terminal Bootstrap:
// - Ensures Homebrew & /usr/local/bin are on PATH
// - Clones via git OR downloads & extracts main.tar.gz via curl + tar
// - Installs dependencies & launches live Cloudflare tunnel + QR code
const MAC_SELF_HEALING_ONELINER = `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; if ! command -v node >/dev/null 2>&1; then if command -v brew >/dev/null 2>&1; then brew install node; else echo "Install Node.js LTS from https://nodejs.org first"; fi; fi; if [ ! -f "$HOME/HELPER/package.json" ]; then if command -v git >/dev/null 2>&1; then git clone ${REPO_GIT} "$HOME/HELPER"; else curl -fsSL "${REPO_TAR}" | tar -xz -C /tmp && rm -rf "$HOME/HELPER" && mv /tmp/HELPER-main "$HOME/HELPER"; fi; fi; cd "$HOME/HELPER" && (git pull --ff-only 2>/dev/null || true) && npm install && npm run live`;

function buildWindowsAutoBatchFile(): string {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'chcp 65001 >nul 2>nul',
    'title DevDeck Windows Auto-Installer ^& Live Bridge',
    'echo.',
    'echo  ================================================================',
    'echo   DEVDECK 1-CLICK WINDOWS 10/11 AUTO-INSTALLER ^& LIVE BRIDGE',
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
    'echo "  DEVDECK 1-CLICK macOS AUTO-INSTALLER & LIVE BRIDGE"',
    'echo " ================================================================"',
    'echo ""',
    MAC_SELF_HEALING_ONELINER,
    '',
  ].join('\n');
}

function synthesizeClientAiCommand(
  prompt: string,
  targetOs: OsKind,
): { command: string; explanation: string } {
  const q = prompt.toLowerCase();
  if (/install|start|build|create|setup|launch|bootstrap|bridge/i.test(q) && !/update|pull/i.test(q)) {
    return {
      command: targetOs === 'windows' ? WIN_SELF_HEALING_ONELINER : MAC_SELF_HEALING_ONELINER,
      explanation:
        targetOs === 'windows'
          ? 'Self-healing Windows PowerShell bootstrapper: bypasses ExecutionPolicy, installs Node.js if missing, refreshes PATH, downloads HELPER (even without Git), installs packages via npm.cmd, and starts the Cloudflare HTTPS tunnel.'
          : 'Self-healing macOS Terminal bootstrapper: configures Homebrew PATH, downloads HELPER, installs dependencies, and starts the live Cloudflare HTTPS tunnel + iPhone QR code.',
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
          ? 'Set-Location "$env:USERPROFILE\\HELPER"; git pull --ff-only; & npm.cmd install; & npm.cmd run build -w mac-bridge'
          : 'cd ~/HELPER && git pull --ff-only && npm install && npm run build -w mac-bridge',
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
}

export default function SetupGuidePage() {
  useWakeLock();
  const [os, setOs] = useState<OsKind>('windows');
  const [detectedOs, setDetectedOs] = useState<string>('');

  // Live Local/Remote Bridge & Terminal Takeover State
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

  // Interactive Terminal / PowerShell & AI Copilot State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiExplanation, setAiExplanation] = useState(
    'Select a 1-tap preset or ask AI to build, fix, or control your Windows PowerShell or macOS Terminal.',
  );
  const [shellCommand, setShellCommand] = useState(WIN_SELF_HEALING_ONELINER);
  const [shellRunning, setShellRunning] = useState(false);
  const [shellHistory, setShellHistory] = useState<ShellOutputEntry[]>([]);
  const [cmdCopied, setCmdCopied] = useState(false);

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

    // Load saved pairing if present
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

  // Probe local bridge (127.0.0.1:4747) & configured bridgeUrl every 4s
  const probeBridge = useCallback(async () => {
    const candidates = Array.from(
      new Set([bridgeUrl.replace(/\/+$/, ''), 'http://127.0.0.1:4747']),
    );
    for (const base of candidates) {
      if (!base) continue;
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 1800);
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
          return true;
        }
      } catch {
        window.clearTimeout(timer);
      }
    }
    setBridgeOnline(false);
    return false;
  }, [bridgeUrl]);

  useEffect(() => {
    void probeBridge();
    const t = window.setInterval(() => void probeBridge(), 4000);
    return () => window.clearInterval(t);
  }, [probeBridge]);

  const handleConnectTerminal = async () => {
    setConnectingBridge(true);
    try {
      const base = bridgeUrl.replace(/\/+$/, '') || 'http://127.0.0.1:4747';
      // 1. Try 1-click loopback auto-pair first if running on this computer
      const localRes = await fetch(`${base}/api/pair/local`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }).catch(() => null);

      if (localRes && localRes.ok) {
        const data = (await localRes.json()) as {
          ok: boolean;
          token: string;
          pin?: string;
          host: string;
          port: number;
          platform?: string;
          hostname?: string;
          tunnelUrl?: string;
        };
        if (data.ok && data.token) {
          setBridgeToken(data.token);
          if (data.pin) setBridgePin(data.pin);
          setBridgeOnline(true);
          setBridgeHostInfo(data);
          window.localStorage.setItem(
            PAIRING_STORAGE_KEY,
            JSON.stringify({
              host: data.host,
              port: data.port,
              token: data.token,
              bridgeUrl: data.tunnelUrl || base,
            }),
          );
          setAiExplanation(
            `Connected to local ${data.platform === 'win32' ? 'Windows PowerShell' : 'macOS Terminal'} on ${data.hostname || data.host}! You can now execute commands directly from this browser.`,
          );
          return;
        }
      }

      // 2. Otherwise pair with 6-digit PIN
      if (!bridgePin.trim()) {
        setAiExplanation(
          'Enter the 6-digit PIN shown in your computer terminal (or open /setup directly on the computer running the bridge for 1-click auto-takeover).',
        );
        return;
      }
      const pinRes = await fetch(`${base}/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: bridgePin.trim() }),
      });
      const pinData = (await pinRes.json()) as {
        ok?: boolean;
        token?: string;
        host?: string;
        port?: number;
        hostname?: string;
        platform?: string;
        tunnelUrl?: string;
        error?: string;
      };
      if (!pinRes.ok || !pinData.ok || !pinData.token) {
        throw new Error(pinData.error || 'Invalid 6-digit PIN');
      }
      setBridgeToken(pinData.token);
      setBridgeOnline(true);
      setBridgeHostInfo(pinData);
      window.localStorage.setItem(
        PAIRING_STORAGE_KEY,
        JSON.stringify({
          host: pinData.host || '127.0.0.1',
          port: pinData.port || 4747,
          token: pinData.token,
          bridgeUrl: base,
        }),
      );
      setAiExplanation(
        `Paired & connected to ${pinData.hostname || base}! Remote PowerShell / Terminal execution is live.`,
      );
    } catch (err) {
      setAiExplanation(
        err instanceof Error
          ? err.message
          : 'Could not reach bridge yet — run the 1-Click Auto-Installer below first.',
      );
    } finally {
      setConnectingBridge(false);
    }
  };

  const handleRunInHostTerminal = async (cmdOverride?: string) => {
    const cmdToRun = (cmdOverride ?? shellCommand).trim();
    if (!cmdToRun || shellRunning) return;
    if (cmdOverride) setShellCommand(cmdOverride);

    if (!bridgeOnline || !bridgeToken) {
      // Not connected yet -> copy command & explain how to run
      void navigator.clipboard?.writeText(cmdToRun);
      setCmdCopied(true);
      window.setTimeout(() => setCmdCopied(false), 1800);
      setAiExplanation(
        `Command copied to clipboard! Paste it into ${os === 'windows' ? 'Windows PowerShell' : 'macOS Terminal'} (or click "Download 1-Click Auto-Installer" below) to launch the bridge. Once running, this console connects automatically.`,
      );
      return;
    }

    setShellRunning(true);
    try {
      const base = bridgeUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/api/devsuite/host-shell`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bridgeToken}`,
        },
        body: JSON.stringify({ command: cmdToRun }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        durationMs?: number;
        shell?: string;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || 'Command execution failed');
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
      };
      setShellHistory((prev) => [entry, ...prev].slice(0, 12));
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

      // Client-side AI command synthesizer (works even before the bridge is installed!)
      const synth = synthesizeClientAiCommand(q, os);
      setShellCommand(synth.command);
      setAiExplanation(synth.explanation);
    } finally {
      setAiBusy(false);
    }
  };

  const handleDownloadAutoInstaller = () => {
    const isWin = os === 'windows';
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
            <span className="setup-label">Setup &amp; Terminal Control</span>
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
                : 'Bridge Standby'}
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

      <main className="relative z-10 mx-auto max-w-5xl space-y-8 px-5 py-7 pb-20">
        {/* Hero Banner + OS Switcher + 1-Click Auto-Installer Download */}
        <section className="setup-hero space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="setup-intro max-w-2xl space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#88f1d1]/35 bg-[#88f1d1]/12 px-2.5 py-1 text-[11px] font-bold text-[#88f1d1]">
                  <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                  Zero-Friction Windows 10/11 &amp; macOS Bridge
                </span>
                {detectedOs && (
                  <span className="rounded-full border border-[#98c8ce29] bg-[#0a151c] px-2.5 py-1 font-mono-tech text-[11px] text-[#9cb4bb]">
                    Detected: {detectedOs}
                  </span>
                )}
              </div>

              <h1 className="disp text-[32px] leading-[0.98] text-[#effaf7] sm:text-[42px]">
                DevDeck Bridge &amp; AI Terminal Control
              </h1>
              <p className="text-sm leading-relaxed text-[#b8d0d6]">
                Build, launch, or control your <strong>Windows PowerShell</strong> or{' '}
                <strong>macOS Terminal</strong> bridge directly from the browser. Includes a
                1-click self-healing installer (no Git required), persistent sub-5ms PowerShell
                engine, native CPU die thermals, and an automatic Cloudflare HTTPS tunnel.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:min-w-[250px]">
              <button
                type="button"
                onClick={handleDownloadAutoInstaller}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#88f1d1] px-4 py-3 text-xs font-extrabold text-[#08221c] shadow-lg transition-transform active:scale-98"
              >
                <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
                {os === 'windows'
                  ? 'Download 1-Click Windows Setup (.bat)'
                  : 'Download 1-Click macOS Setup (.command)'}
              </button>
              <a
                href={REPO_ZIP}
                className="flex items-center justify-center gap-2 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] px-4 py-2 text-xs font-bold text-[#effaf7] transition-colors hover:border-[#88f1d1]"
              >
                <Download aria-hidden="true" className="h-3.5 w-3.5 text-[#88f1d1]" />
                Download Full Repository ZIP
              </a>
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
              Windows 10 / 11 (PowerShell)
            </button>
            <button type="button" aria-pressed={os === 'mac'} onClick={() => switchOs('mac')}>
              <Terminal size={16} aria-hidden="true" />
              macOS (Terminal / zsh)
            </button>
          </div>
        </section>

        {/* ============ BROWSER TERMINAL / POWERSHELL CONTROL & AI AUTOPILOT ============ */}
        <section className="rounded-3xl border border-[#98c8ce33] bg-[#101d25] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-[#88f1d1]/35 bg-[#88f1d1]/14 text-[#88f1d1]">
                <Terminal aria-hidden="true" className="h-4 w-4" />
              </div>
              <div>
                <h2 className="disp text-[22px] text-[#effaf7]">
                  Browser {os === 'windows' ? 'PowerShell' : 'Terminal'} Control &amp; AI Bridge Builder
                </h2>
                <p className="text-xs text-[#9cb4bb]">
                  Generate self-healing setup commands with AI or take live remote control of your{' '}
                  {os === 'windows' ? 'Windows PowerShell' : 'macOS Terminal'} once the bridge is running.
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
                  <Zap aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {bridgeToken
                  ? 'Terminal Linked'
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
                    ? 'Ask AI or paste a PowerShell error (e.g. "npm.ps1 cannot be loaded", "install & start bridge")…'
                    : 'Ask AI or paste a Terminal error (e.g. "install Node & start bridge", "clear port 4747")…'
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
              AI Generate Command
            </button>
          </form>

          {/* AI Explanation Banner */}
          <div className="rounded-xl border border-[#88f1d1]/25 bg-[#0a151c] px-3.5 py-2.5 text-xs leading-relaxed text-[#d4f5e9]">
            <strong className="mr-1.5 text-[#88f1d1]">AI Autopilot:</strong>
            {aiExplanation}
          </div>

          {/* Editable Command Box + Execute / Copy / Download Controls */}
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
                    ? `Execute in ${os === 'windows' ? 'PowerShell' : 'Terminal'}`
                    : `Copy & Run in ${os === 'windows' ? 'PowerShell' : 'Terminal'}`}
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
              <div className="deck-scroll max-h-60 space-y-2 overflow-y-auto border-t border-[#98c8ce22] pt-2.5">
                {shellHistory.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[#98c8ce22] bg-[#0a151c] p-2.5 font-mono-tech text-[11px]"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-[#9cb4bb]">
                      <span className="truncate font-bold text-[#88f1d1]">$ {item.command}</span>
                      <span className="shrink-0">
                        {item.shell} · exit {item.exitCode} · {item.durationMs}ms
                      </span>
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
              1-Command Self-Healing Setup ({os === 'windows' ? 'Windows PowerShell' : 'macOS Terminal'})
            </h2>
          </div>

          {os === 'windows' ? (
            <CopyBlock
              label="Windows PowerShell — Self-Healing Install + Launch (Works Even Without Git!)"
              accent="#88f1d1"
              code={WIN_SELF_HEALING_ONELINER}
              hint="Open Windows PowerShell, paste this single block, and press Enter. It automatically bypasses ExecutionPolicy, installs Node.js if needed, reloads PATH, downloads HELPER, and prints your iPhone QR code."
            />
          ) : (
            <CopyBlock
              label="macOS Terminal — Self-Healing Install + Launch (Copy & Paste)"
              accent="#88f1d1"
              code={MAC_SELF_HEALING_ONELINER}
              hint="Open macOS Terminal, paste this block, and press Enter. Wait ~5 seconds for the Cloudflare HTTPS tunnel and 1-scan iPhone QR code."
            />
          )}
        </section>

        {/* Complete Step-by-Step Guide */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Wrench aria-hidden="true" className="h-5 w-5 text-[#7dd3fc]" />
            <h2 className="disp text-[24px] text-[#effaf7]">
              Step-by-Step {os === 'windows' ? 'Windows 10 / 11' : 'macOS'} Guide
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-[#98c8ce29] bg-[#101d25] p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#88f1d1]/15 font-mono-tech text-xs font-extrabold text-[#88f1d1]">
                  01
                </span>
                <h3 className="text-sm font-extrabold text-[#effaf7]">
                  1-Click File or Node.js LTS
                </h3>
              </div>
              {os === 'windows' ? (
                <>
                  <p className="text-xs leading-relaxed text-[#b8d0d6]">
                    Either double-click the downloaded{' '}
                    <code className="text-[#88f1d1]">DevDeck-Windows-AutoSetup.bat</code> (which
                    installs Node.js automatically via <code>winget</code>), or run:
                  </p>
                  <CopyBlock
                    label="PowerShell"
                    code={`winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements`}
                  />
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-[#b8d0d6]">
                    Install Node.js LTS via Homebrew or from{' '}
                    <a
                      href="https://nodejs.org"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#88f1d1] underline"
                    >
                      nodejs.org
                    </a>
                    :
                  </p>
                  <CopyBlock label="macOS Terminal" code={`brew install node && node -v`} />
                </>
              )}
            </div>

            <div className="space-y-3 rounded-2xl border border-[#98c8ce29] bg-[#101d25] p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#7dd3fc]/15 font-mono-tech text-xs font-extrabold text-[#7dd3fc]">
                  02
                </span>
                <h3 className="text-sm font-extrabold text-[#effaf7]">
                  Download &amp; Install Dependencies
                </h3>
              </div>
              <p className="text-xs leading-relaxed text-[#b8d0d6]">
                Uses <code className="text-[#88f1d1]">npm.cmd</code> on Windows so PowerShell
                ExecutionPolicy never blocks installation.
              </p>
              <CopyBlock
                label={os === 'windows' ? 'PowerShell' : 'macOS Terminal'}
                code={
                  os === 'windows'
                    ? `git clone ${REPO_GIT} "$env:USERPROFILE\\HELPER"\ncd "$env:USERPROFILE\\HELPER"\n& npm.cmd install`
                    : `git clone ${REPO_GIT} ~/HELPER\ncd ~/HELPER\nnpm install`
                }
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-[#98c8ce29] bg-[#101d25] p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fbbf24]/15 font-mono-tech text-xs font-extrabold text-[#fbbf24]">
                  03
                </span>
                <h3 className="text-sm font-extrabold text-[#effaf7]">
                  Start Fast Bridge + HTTPS Tunnel
                </h3>
              </div>
              {os === 'windows' ? (
                <>
                  <p className="text-xs leading-relaxed text-[#b8d0d6]">
                    Double-click <code className="text-[#fbbf24]">start-windows.bat</code> in your{' '}
                    <code>HELPER</code> folder, or run in PowerShell:
                  </p>
                  <CopyBlock
                    label="PowerShell (Daily Launch)"
                    accent="#fbbf24"
                    code={`cd "$env:USERPROFILE\\HELPER"\n& npm.cmd run live`}
                    hint="Automatically downloads standalone cloudflared.exe over HTTP/2 and prints your QR code."
                  />
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-[#b8d0d6]">
                    Double-click <code className="text-[#fbbf24]">start-mac.command</code> in Finder,
                    or run in Terminal:
                  </p>
                  <CopyBlock
                    label="macOS Terminal (Daily Launch)"
                    accent="#fbbf24"
                    code={`cd ~/HELPER && npm run live`}
                    hint="Compiles native 120Hz CoreGraphics mouse daemon & IOKit die thermal probe automatically."
                  />
                </>
              )}
            </div>

            <div className="space-y-3 rounded-2xl border border-[#98c8ce29] bg-[#101d25] p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#88f1d1]/15 font-mono-tech text-xs font-extrabold text-[#88f1d1]">
                  04
                </span>
                <h3 className="text-sm font-extrabold text-[#effaf7]">
                  Scan QR on iPhone &amp; Add to Home Screen
                </h3>
              </div>
              <ul role="list" className="space-y-2 text-xs leading-relaxed text-[#b8d0d6]">
                <li className="flex items-start gap-2">
                  <QrCode aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#88f1d1]" />
                  <span>
                    <strong>1-Scan QR Code:</strong> Point your iPhone Camera at the QR code in
                    PowerShell/Terminal. It pairs automatically and stays awake while open.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Smartphone
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#7dd3fc]"
                  />
                  <span>
                    <strong>Install Full-Screen PWA:</strong> In iPhone Safari, tap{' '}
                    <strong>Share → Add to Home Screen</strong>.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Permissions & Antigravity MCP Config */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-[#98c8ce29] bg-[#101d25] p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[#88f1d1]" />
              <h3 className="disp text-[20px] text-[#effaf7]">
                {os === 'windows' ? 'Windows Speed & Admin Architecture' : 'macOS Native Architecture'}
              </h3>
            </div>
            {os === 'windows' ? (
              <ul role="list" className="space-y-2 text-xs leading-relaxed text-[#b8d0d6]">
                <li>
                  • <strong>Persistent Sub-5ms PowerShell Engine:</strong> Keeps a single warm
                  background worker with pre-compiled Win32 P/Invoke types so CPU usage stays near
                  0%.
                </li>
                <li>
                  • <strong>HiDPI-Aware Mouse Daemon:</strong> Uses{' '}
                  <code>SetProcessDPIAware()</code> and invariant-culture subpixel accumulation for
                  1:1 trackpad &amp; 60Hz Air Mouse accuracy on 125%–200% scaled Windows displays.
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
                  • <strong>Native IOKit &amp; AppleSMC Die Thermals:</strong> Reads real Apple
                  Silicon <code>IOHIDEventSystem</code> CPU/GPU/Battery die thermistors and{' '}
                  <code>AppleSMC</code> sensors in &lt;3ms without <code>sudo</code>.
                </li>
                <li>
                  • <strong>120Hz CoreGraphics Mouse Daemon:</strong> Compiles{' '}
                  <code>mouse_daemon.c</code> automatically via Apple <code>clang</code> for
                  sub-0.1ms cursor and keyboard control.
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
