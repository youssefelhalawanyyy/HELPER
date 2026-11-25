'use client';

import { useEffect, useState } from 'react';
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
  MousePointerClick,
  QrCode,
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
const APP_URL = 'https://helper-nu-swart.vercel.app';

function CopyBlock({
  label,
  code,
  hint,
  accent = '#22d3ee',
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
          className="flex items-center gap-1.5 rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] px-2.5 py-1 text-[11px] font-bold text-[#effaf7] transition-colors hover:border-[#88f1d1]"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[#34d399]" />
              <span className="text-[#34d399]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="font-mono-tech overflow-x-auto p-3.5 text-[12.5px] leading-relaxed text-[#e5f4ff] select-all">
        <code>{code}</code>
      </pre>
      {hint && (
        <div className="border-t border-white/[0.05] bg-white/[0.015] px-3.5 py-2 text-[12px] text-zinc-400">
          {hint}
        </div>
      )}
    </div>
  );
}

const FEATURES = [
  {
    icon: Zap,
    color: '#34d399',
    title: 'Smart Macro Deck',
    desc: 'Profile-aware tactile keycaps that auto-switch for Antigravity IDE, VS Code, Chrome, and Terminal.',
  },
  {
    icon: Bot,
    color: '#22d3ee',
    title: 'Antigravity Live Mirror',
    desc: 'Real-time agent chat, thinking blocks, tool cards, live IDE agent terminal, session switcher & color git diffs.',
  },
  {
    icon: MousePointerClick,
    color: '#fbbf24',
    title: '120Hz Trackpad & Snap',
    desc: 'Native CoreGraphics (Mac) & Win32 user32.dll (Windows) mouse daemon with One-Euro filter, 2-finger scroll & Window Snap.',
  },
  {
    icon: HeartPulse,
    color: '#ff5d6c',
    title: 'PC & Mac Rescue Doctor',
    desc: 'Virus/Defender & Gatekeeper scan, SFC/DISM & plutil corruption checks, live terminal, and plain-English repair report.',
  },
  {
    icon: Activity,
    color: '#f472b6',
    title: 'Live Monitor & Ports',
    desc: 'Streaming dev logs, Git status/deploy, webhook inspector, and 1-tap port & CPU hog killer.',
  },
  {
    icon: Cpu,
    color: '#a78bfa',
    title: 'Hardware & App Dock',
    desc: 'Battery health, per-core CPU, Bluetooth, Wi-Fi/VPN, speed test, Lock/Wake, Caffeine & instant App Dock.',
  },
  {
    icon: Clock,
    color: '#60a5fa',
    title: 'OLED Desk Clock',
    desc: 'Always-on weather, 3 world clocks, Pomodoro/break timers, and live clipboard URL sync.',
  },
  {
    icon: Rocket,
    color: '#fbbf24',
    title: 'Zero Cloud · Free Forever',
    desc: 'Static Vercel PWA paired over an encrypted Cloudflare Quick Tunnel directly to your computer.',
  },
];

export default function SetupGuidePage() {
  useWakeLock();
  const [os, setOs] = useState<OsKind>('windows');
  const [detectedOs, setDetectedOs] = useState<string>('');

  useEffect(() => {
    const hash = window.location.hash.toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    const isMacUa = ua.includes('mac os') || ua.includes('macintosh');
    const isWinUa = ua.includes('windows');
    setDetectedOs(isMacUa ? 'macOS' : isWinUa ? 'Windows' : 'Desktop');

    if (hash === '#mac') {
      setOs('mac');
    } else if (hash === '#windows' || hash === '#win') {
      setOs('windows');
    } else if (isMacUa) {
      setOs('mac');
    } else {
      setOs('windows');
    }
  }, []);

  const switchOs = (next: OsKind) => {
    setOs(next);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${next}`);
    }
  };

  const winExpressCmd = `winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
git clone ${REPO_GIT} "$env:USERPROFILE\\HELPER"
cd "$env:USERPROFILE\\HELPER"
npm install
npm run live`;

  const macExpressCmd = `git clone ${REPO_GIT} ~/HELPER
cd ~/HELPER
npm install
npm run live`;

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
      <header className="sticky top-0 z-30 border-b border-[#98c8ce29] bg-[#0d1921]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <Brand />
            <span className="setup-label">Setup guide</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white sm:flex"
            >
              GitHub
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-full bg-[#22d3ee] px-3.5 py-1.5 text-xs font-extrabold text-[#041016] transition-transform active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Open DevDeck
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl space-y-10 px-5 py-8 pb-20">
        {/* Hero */}
        <section className="setup-hero">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="setup-intro max-w-2xl space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#34d399]/30 bg-[#34d399]/10 px-2.5 py-1 text-[11px] font-bold text-[#34d399]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Works on Any New Windows 10/11 PC or Mac
                </span>
                {detectedOs && (
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono-tech text-[11px] text-zinc-300">
                    Detected: {detectedOs}
                  </span>
                )}
              </div>

              <h1 className="disp text-[34px] leading-[0.95] text-white sm:text-[44px]">
                Set up DevDeck Bridge
              </h1>
              <p className="text-sm leading-relaxed text-zinc-300">
                Run the lightweight local bridge on your <strong>Windows PC</strong> or{' '}
                <strong>Mac</strong> to connect your iPhone to Antigravity IDE, a 120Hz hardware
                trackpad, Window Snap, live system monitoring, and the PC/Mac Rescue Doctor — over
                an automatic encrypted HTTPS tunnel with a 1-scan QR code.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:min-w-[210px]">
              <a
                href={REPO_ZIP}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-extrabold text-white transition-colors hover:bg-white/10"
              >
                <Download className="h-4 w-4 text-[#22d3ee]" />
                Download Project ZIP
              </a>
              <div className="rounded-xl border border-white/[0.07] bg-black/50 px-3 py-2 text-center font-mono-tech text-[11px] text-zinc-400">
                PWA URL: <span className="text-[#22d3ee]">{APP_URL.replace('https://', '')}</span>
              </div>
            </div>
          </div>

          {/* Direct Sublinks Bar */}
          <div className="setup-platforms" role="group" aria-label="Computer operating system">
            <button type="button" aria-pressed={os === 'windows'} onClick={() => switchOs('windows')}><Laptop size={16} />Windows 10 / 11</button>
            <button type="button" aria-pressed={os === 'mac'} onClick={() => switchOs('mac')}><Terminal size={16} />macOS</button>
          </div>
        </section>

        {/* Express 1-Block Installer for Brand-New Computers */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-[#34d399]" />
            <h2 className="disp text-[24px] text-white">
              Fastest Setup for a Brand-New {os === 'windows' ? 'Windows PC' : 'Mac'}
            </h2>
          </div>

          {os === 'windows' ? (
            <CopyBlock
              label="Windows PowerShell — Full First-Time Install + Launch (Copy & Paste)"
              accent="#60a5fa"
              code={winExpressCmd}
              hint="Open PowerShell (right-click → Run as Administrator for full Defender + SFC/DISM repair), paste this block, press Enter, and scan the QR code with your iPhone."
            />
          ) : (
            <CopyBlock
              label="macOS Terminal — Full First-Time Install + Launch (Copy & Paste)"
              accent="#34d399"
              code={macExpressCmd}
              hint="Requires Node.js LTS (nodejs.org or `brew install node`). Wait ~5 seconds for the Cloudflare HTTPS tunnel and 1-scan iPhone QR code."
            />
          )}
        </section>

        {/* Complete Step-by-Step Guide */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-[#22d3ee]" />
            <h2 className="disp text-[24px] text-white">
              Step-by-Step {os === 'windows' ? 'Windows 10 / 11' : 'macOS'} Instructions
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Step 1 */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#101218] p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#22d3ee]/15 font-mono-tech text-xs font-extrabold text-[#22d3ee]">
                  01
                </span>
                <h3 className="text-sm font-extrabold text-white">Install Node.js LTS &amp; Git</h3>
              </div>
              {os === 'windows' ? (
                <>
                  <p className="text-xs leading-relaxed text-zinc-300">
                    On a brand-new Windows PC, install Node.js LTS and Git using Windows&apos;s
                    built-in <code className="text-[#22d3ee]">winget</code> command, or download
                    directly from{' '}
                    <a
                      href="https://nodejs.org"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#22d3ee] underline"
                    >
                      nodejs.org
                    </a>
                    .
                  </p>
                  <CopyBlock
                    label="PowerShell"
                    code={`winget install -e --id OpenJS.NodeJS.LTS\nwinget install -e --id Git.Git`}
                  />
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-zinc-300">
                    Install Node.js LTS via Homebrew or download the official macOS installer from{' '}
                    <a
                      href="https://nodejs.org"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#22d3ee] underline"
                    >
                      nodejs.org
                    </a>
                    . Git comes preinstalled via Apple Command Line Tools.
                  </p>
                  <CopyBlock
                    label="macOS Terminal"
                    code={`brew install node\nnode -v`}
                  />
                </>
              )}
            </div>

            {/* Step 2 */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#101218] p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#34d399]/15 font-mono-tech text-xs font-extrabold text-[#34d399]">
                  02
                </span>
                <h3 className="text-sm font-extrabold text-white">Clone &amp; Install Dependencies</h3>
              </div>
              <p className="text-xs leading-relaxed text-zinc-300">
                Download the repository once and install the bridge dependencies. No C++ compiler or
                Xcode is required on Windows.
              </p>
              <CopyBlock
                label={os === 'windows' ? 'PowerShell' : 'macOS Terminal'}
                code={
                  os === 'windows'
                    ? `git clone ${REPO_GIT}\ncd HELPER\nnpm install`
                    : `git clone ${REPO_GIT} ~/HELPER\ncd ~/HELPER\nnpm install`
                }
              />
            </div>

            {/* Step 3 */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#101218] p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#fbbf24]/15 font-mono-tech text-xs font-extrabold text-[#fbbf24]">
                  03
                </span>
                <h3 className="text-sm font-extrabold text-white">
                  Start Live Bridge + HTTPS Tunnel
                </h3>
              </div>
              {os === 'windows' ? (
                <>
                  <p className="text-xs leading-relaxed text-zinc-300">
                    Run <code className="text-[#fbbf24]">npm run live</code> OR open the{' '}
                    <code className="text-[#fbbf24]">HELPER</code> folder and{' '}
                    <strong>right-click start-windows.bat → Run as Administrator</strong>.
                  </p>
                  <CopyBlock
                    label="PowerShell (Daily Launch)"
                    accent="#fbbf24"
                    code={`cd HELPER\nnpm run live`}
                    hint="Allow Node.js / cloudflared if Windows Defender Firewall pops up."
                  />
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-zinc-300">
                    One command starts the local bridge, opens a free encrypted Cloudflare HTTPS
                    tunnel, and prints your 1-scan iPhone QR code + 6-digit PIN.
                  </p>
                  <CopyBlock
                    label="macOS Terminal (Daily Launch)"
                    accent="#fbbf24"
                    code={`cd ~/HELPER && npm run live`}
                    hint="Keep this terminal window open while using DevDeck on your iPhone."
                  />
                </>
              )}
            </div>

            {/* Step 4 */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#101218] p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#a78bfa]/15 font-mono-tech text-xs font-extrabold text-[#a78bfa]">
                  04
                </span>
                <h3 className="text-sm font-extrabold text-white">Pair Your iPhone &amp; Install PWA</h3>
              </div>
              <ul className="space-y-2 text-xs leading-relaxed text-zinc-300">
                <li className="flex items-start gap-2">
                  <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-[#22d3ee]" />
                  <span>
                    <strong>1-Scan QR Code:</strong> Point your iPhone Camera at the QR code printed
                    in Terminal/PowerShell and tap the link. It pairs automatically.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" />
                  <span>
                    <strong>Full-Screen App Icon:</strong> In iPhone Safari, tap{' '}
                    <strong>Share → Add to Home Screen</strong> to install DevDeck with its custom
                    OLED hardware icon.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#a78bfa]" />
                  <span>
                    <strong>Manual Backup:</strong> Open <code>{APP_URL}</code>, tap{' '}
                    <strong>PAIR COMPUTER</strong>, and paste the{' '}
                    <code>https://….trycloudflare.com</code> URL + 6-digit PIN.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Permissions & Antigravity MCP Config */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.08] bg-[#101218] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#34d399]" />
              <h3 className="disp text-[20px] text-white">
                {os === 'windows' ? 'Windows Permissions & Admin Mode' : 'macOS Permissions'}
              </h3>
            </div>
            {os === 'windows' ? (
              <ul className="space-y-2 text-xs leading-relaxed text-zinc-300">
                <li>
                  • <strong>Administrator Mode (Recommended):</strong> Right-click{' '}
                  <code className="text-[#22d3ee]">start-windows.bat</code> →{' '}
                  <strong>Run as Administrator</strong> so PC Rescue can execute full{' '}
                  <code>DISM /RestoreHealth</code>, <code>sfc /scannow</code>, and Windows Defender
                  scans.
                </li>
                <li>
                  • <strong>Firewall Prompt:</strong> Check <em>Private networks</em> and click{' '}
                  <strong>Allow access</strong> when Windows asks about Node.js or cloudflared.
                </li>
                <li>
                  • <strong>Antigravity IDE Path:</strong> DevDeck automatically reads{' '}
                  <code className="text-[#34d399]">%USERPROFILE%\.gemini\antigravity\brain\</code>{' '}
                  on Windows for live chat, agent terminal &amp; color git diffs.
                </li>
              </ul>
            ) : (
              <ul className="space-y-2 text-xs leading-relaxed text-zinc-300">
                <li>
                  • <strong>Accessibility Permission:</strong> Open{' '}
                  <em>System Settings → Privacy &amp; Security → Accessibility</em> and enable{' '}
                  <strong>Terminal</strong> (and Antigravity IDE / VS Code if launching from there)
                  so Trackpad, Window Snap, and Keyboard Shortcuts work smoothly.
                </li>
                <li>
                  • <strong>120Hz Native Mouse Daemon:</strong> On first run, macOS compiles{' '}
                  <code>mouse_daemon.c</code> automatically via Apple <code>clang</code> for
                  zero-lag cursor &amp; 2-finger scroll.
                </li>
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#101218] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-[#22d3ee]" />
              <h3 className="disp text-[20px] text-white">Antigravity MCP Server (Optional)</h3>
            </div>
            <p className="text-xs leading-relaxed text-zinc-300">
              Add this to{' '}
              <code className="text-[#22d3ee]">
                {os === 'windows'
                  ? '%USERPROFILE%\\.gemini\\antigravity\\mcp_config.json'
                  : '~/.gemini/antigravity/mcp_config.json'}
              </code>{' '}
              so Antigravity agents can send alerts, progress bars, and approval prompts straight to
              your iPhone:
            </p>
            <CopyBlock
              label="mcp_config.json"
              accent="#a78bfa"
              code={os === 'windows' ? winMcpJson : macMcpJson}
            />
          </div>
        </section>

        {/* Updating & Troubleshooting */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#101218] p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="disp text-[22px] text-white">Updating &amp; Quick Fixes</h2>
            <span className="font-mono-tech text-[11px] text-zinc-400">
              Always free on Vercel Hobby
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <CopyBlock
              label="Update Any Computer to Latest Version"
              accent="#34d399"
              code={
                os === 'windows'
                  ? `cd HELPER\ngit pull\nnpm install\nnpm run live`
                  : `cd ~/HELPER && git pull && npm install && npm run live`
              }
            />

            <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-black/50 p-3.5 text-xs text-zinc-300">
              <div className="font-bold text-white">Troubleshooting Checklist</div>
              <div>
                • <strong>iPhone won&apos;t connect?</strong> Make sure <code>npm run live</code> is
                still running and scan the newest QR code (tunnel URLs rotate on restart).
              </div>
              <div>
                • <strong>Port 4747 already in use?</strong> Close any older DevDeck terminal window
                and run <code>npm run live</code> again.
              </div>
              <div>
                • <strong>Old UI showing on iPhone?</strong> Pull down to refresh in Safari, or
                close and reopen the Home Screen icon.
              </div>
            </div>
          </div>
        </section>

        {/* All 8 Features Grid */}
        <section className="space-y-4">
          <h2 className="disp text-[24px] text-white">What&apos;s Included Across All 8 Tabs</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-2xl border border-white/[0.07] bg-[#101218] p-4"
                >
                  <div
                    className="mb-2.5 grid h-9 w-9 place-items-center rounded-xl"
                    style={{ background: `${f.color}1c`, color: f.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="text-xs font-extrabold text-white">{f.title}</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
