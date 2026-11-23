'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  KeyRound,
  Laptop,
  Loader2,
  Radio,
  RefreshCw,
  Router,
  Shield,
  Sparkles,
  Terminal,
  Wifi,
  Zap,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';
import type { NetworkFixAction } from '@/types/protocol';

function gradeColor(grade: string): string {
  if (grade === 'ULTRA') return '#34d399';
  if (grade === 'FAST') return '#22d3ee';
  if (grade === 'FAIR') return '#fbbf24';
  if (grade === 'SLOW') return '#ff5d6c';
  return '#60a5fa';
}

export function NetworkCommandView({ deck }: { deck: DevDeckState }) {
  const [rightTab, setRightTab] = useState<'ai' | 'devices' | 'log'>('ai');
  const [showPass, setShowPass] = useState(false);
  const autoScannedRef = useRef(false);
  const net = deck.networkState;
  const accent = gradeColor(net.grade);
  const busy = net.scanning || net.testingSpeed || net.fixing;

  useEffect(() => {
    if (autoScannedRef.current) return;
    if (deck.status === 'connected' && net.updatedAt === 0 && !net.scanning) {
      autoScannedRef.current = true;
      deck.sendEvent({ type: 'network:scan', payload: { requestId: makeRequestId() } });
    }
  }, [deck, net.updatedAt, net.scanning]);

  const runScan = () => {
    soundEngine.playClick();
    deck.sendEvent({ type: 'network:scan', payload: { requestId: makeRequestId() } });
  };

  const runSpeed = () => {
    soundEngine.playClick();
    setRightTab('ai');
    deck.sendEvent({ type: 'network:speedtest', payload: { requestId: makeRequestId() } });
  };

  const runFix = (action: NetworkFixAction) => {
    soundEngine.playClick();
    if (action === 'ai_analyze' || action === 'full_net_fix') setRightTab('ai');
    else setRightTab('log');
    deck.sendEvent({ type: 'network:fix', payload: { requestId: makeRequestId(), action } });
  };

  const handleRevealPassword = () => {
    soundEngine.playClick();
    if (net.wifiPassword) {
      setShowPass((v) => !v);
      return;
    }
    setShowPass(true);
    deck.sendEvent({ type: 'network:wifiPassword', payload: { requestId: makeRequestId() } });
  };

  const speedPct = Math.min(100, Math.max(6, ((net.downMbps || 0) / 250) * 100));

  return (
    <div className="grid h-full gap-2" style={{ gridTemplateColumns: '1.08fr 1.72fr' }}>
      {/* LEFT: Speedometer Gauge + Wi-Fi / Public IP / Password + Speed Test & Boost */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3">
        <div
          className="absolute top-0 left-0 h-[3px] w-3/4 rounded-r-full"
          style={{ background: `linear-gradient(90deg, #22d3ee, ${accent})` }}
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Wifi className="h-4 w-4 text-[#22d3ee]" />
            <span className="disp text-[19px]">NetOps Pro</span>
          </div>
          <div className="flex items-center gap-1">
            {net.vpnActive && (
              <span className="flex items-center gap-0.5 rounded-full bg-[#a78bfa]/20 px-1.5 py-0.5 text-[8px] font-extrabold text-[#c4b5fd]">
                <Shield className="h-2.5 w-2.5" />
                VPN
              </span>
            )}
            <span
              className="font-mono-tech rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
              style={{ background: `${accent}20`, color: accent }}
            >
              {net.grade}
            </span>
          </div>
        </div>

        {/* Speedometer Gauge + DL/UL/Ping/Jitter */}
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/70 p-2">
          <div
            className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(${accent} ${speedPct * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
            }}
          >
            <div className="grid h-11 w-11 place-items-center rounded-full bg-[#090b10]">
              {net.testingSpeed ? (
                <Loader2 className="h-5 w-5 animate-spin text-[#22d3ee]" />
              ) : (
                <div className="text-center leading-none">
                  <div className="num font-mono-tech text-[13px] font-extrabold text-white">
                    {net.downMbps !== null ? Math.round(net.downMbps) : '--'}
                  </div>
                  <div className="text-[7px] font-bold text-zinc-400">Mbps</div>
                </div>
              )}
            </div>
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">DOWNLOAD</div>
              <div className="num font-mono-tech text-[10px] font-extrabold text-[#34d399]">
                {net.downMbps !== null ? `${net.downMbps}M` : '--'}
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">UPLOAD</div>
              <div className="num font-mono-tech text-[10px] font-extrabold text-[#22d3ee]">
                {net.upMbps !== null ? `${net.upMbps}M` : '--'}
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">PING</div>
              <div className="num font-mono-tech text-[10px] font-extrabold text-white">
                {net.pingMs !== null ? `${net.pingMs}ms` : '--'}
              </div>
            </div>
            <div className="rounded-lg bg-white/[0.04] px-1.5 py-0.5">
              <div className="text-[7.5px] text-zinc-400">JITTER</div>
              <div className="num font-mono-tech text-[10px] font-extrabold text-[#fbbf24]">
                {net.jitterMs !== null ? `${net.jitterMs}ms` : '--'}
              </div>
            </div>
          </div>
        </div>

        {/* Network Identity & Wi-Fi Password Card */}
        <div className="min-h-0 flex-1 space-y-1.5 rounded-xl border border-white/[0.07] bg-black/65 p-2 text-[9px]">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-extrabold text-white">{net.ssid}</span>
            <span className="font-mono-tech shrink-0 text-[8.5px] text-[#22d3ee]">
              {net.publicIp || '--'}
            </span>
          </div>

          <div className="font-mono-tech flex items-center justify-between gap-1 text-[8px] text-zinc-400">
            <span className="truncate">DNS: {net.dnsServers.join(', ') || '--'}</span>
            <span className="shrink-0">GW: {net.gatewayIp || '--'}</span>
          </div>

          {/* Wi-Fi Password Reveal Row */}
          <div className="flex items-center justify-between gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2 py-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <KeyRound className="h-3 w-3 shrink-0 text-[#fbbf24]" />
              <span className="font-mono-tech truncate text-[9px] font-bold text-zinc-200">
                {net.wifiPassword
                  ? showPass
                    ? net.wifiPassword
                    : '••••••••••••'
                  : net.wifiPasswordNote || 'Wi-Fi Password'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {net.wifiPassword && (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    void navigator.clipboard?.writeText(net.wifiPassword || '');
                    deck.showToast(true, 'Wi-Fi password copied');
                  }}
                  className="rounded bg-white/[0.07] p-1 text-zinc-300 hover:text-white"
                  aria-label="Copy Wi-Fi password"
                >
                  <Copy className="h-2.5 w-2.5" />
                </button>
              )}
              <button
                type="button"
                onClick={handleRevealPassword}
                className="flex items-center gap-0.5 rounded bg-[#fbbf24]/20 px-1.5 py-0.5 text-[8px] font-extrabold text-[#fbbf24]"
              >
                {showPass && net.wifiPassword ? (
                  <>
                    <EyeOff className="h-2.5 w-2.5" /> Hide
                  </>
                ) : (
                  <>
                    <Eye className="h-2.5 w-2.5" /> Reveal
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Primary Buttons (h-8 pixel-aligned with right card) */}
        <div className="grid grid-cols-5 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            disabled={busy}
            onClick={runSpeed}
            className="col-span-2 flex h-8 items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/[0.06] text-[9px] font-extrabold whitespace-nowrap text-white disabled:opacity-40"
          >
            <Gauge className={`h-3.5 w-3.5 shrink-0 ${net.testingSpeed ? 'animate-spin' : ''}`} />
            SPEED
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={DECK_SPRING}
            disabled={busy}
            onClick={() => runFix('full_net_fix')}
            className="col-span-3 flex h-8 items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-[#22d3ee] to-[#34d399] text-[9.5px] font-extrabold whitespace-nowrap text-[#04130c] disabled:opacity-40"
            style={{ boxShadow: '0 2px 0 #14664a' }}
          >
            <Zap className="h-3.5 w-3.5 shrink-0" />
            AI BOOST &amp; FIX
          </motion.button>
        </div>
      </div>

      {/* RIGHT: LAN Devices & IPs | AI Network Verdict | Live Fix Log */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#22d3ee] via-[#a78bfa] to-[#34d399]" />

        {/* 3-Tab Switcher (English Summary first!) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-full bg-black/75 p-0.5">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('ai');
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[8.5px] font-extrabold uppercase"
              style={{
                background: rightTab === 'ai' ? '#1f222c' : 'transparent',
                color: rightTab === 'ai' ? '#a78bfa' : '#7c8190',
              }}
            >
              <Sparkles className="h-3 w-3" />
              English Summary
            </button>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('devices');
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[8.5px] font-extrabold uppercase"
              style={{
                background: rightTab === 'devices' ? '#1f222c' : 'transparent',
                color: rightTab === 'devices' ? '#22d3ee' : '#7c8190',
              }}
            >
              <Radio className="h-3 w-3" />
              Devices ({net.devices.length})
            </button>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setRightTab('log');
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[8.5px] font-extrabold uppercase"
              style={{
                background: rightTab === 'log' ? '#1f222c' : 'transparent',
                color: rightTab === 'log' ? '#34d399' : '#7c8190',
              }}
            >
              <Terminal className="h-3 w-3" />
              Log ({net.fixLog.length})
            </button>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={runScan}
            className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[8px] font-extrabold text-zinc-200 uppercase disabled:opacity-40"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${net.scanning ? 'animate-spin' : ''}`} />
            Scan LAN
          </button>
        </div>

        {/* Body */}
        {rightTab === 'devices' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
            {net.devices.map((dev) => {
              const color = dev.isGateway ? '#fbbf24' : dev.isSelf ? '#34d399' : '#22d3ee';
              const Icon = dev.isGateway ? Router : dev.isSelf ? Laptop : Globe;
              return (
                <div
                  key={dev.ip}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/65 px-2.5 py-1.5"
                  style={{ borderLeftWidth: 2, borderLeftColor: color }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[10px] font-extrabold text-white">
                          {dev.hostname}
                        </span>
                        {dev.isGateway && (
                          <span className="rounded bg-[#fbbf24]/20 px-1 text-[7.5px] font-extrabold text-[#fbbf24]">
                            ROUTER
                          </span>
                        )}
                        {dev.isSelf && (
                          <span className="rounded bg-[#34d399]/20 px-1 text-[7.5px] font-extrabold text-[#34d399]">
                            THIS PC
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[8.5px] text-zinc-400">{dev.vendor}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono-tech text-[9.5px] font-bold text-[#22d3ee]">
                      {dev.ip}
                    </div>
                    <div className="font-mono-tech text-[7.5px] text-zinc-500">{dev.mac}</div>
                  </div>
                </div>
              );
            })}

            {net.devices.length === 0 && (
              <div className="grid h-full place-items-center text-center">
                <div className="sub">Tap &quot;Scan LAN&quot; to discover all IPs &amp; devices on Wi-Fi</div>
              </div>
            )}
          </div>
        )}

        {rightTab === 'ai' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
            {/* Live status pill when scanning/testing */}
            {busy && net.activeAction && (
              <div className="flex items-center gap-2 rounded-xl border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-2.5 py-1.5 text-[9.5px] font-bold text-[#22d3ee]">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>{net.activeAction}</span>
              </div>
            )}

            {/* Plain-English Verdict */}
            <div className="rounded-xl border border-[#a78bfa]/25 bg-black/70 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[9px] font-extrabold tracking-wider text-[#a78bfa] uppercase">
                  <Sparkles className="h-3 w-3" />
                  Plain-English Internet Summary
                </span>
                <span className="font-mono-tech truncate text-[8px] text-zinc-400">
                  {net.isp || (net.dnsMs ? `DNS ${net.dnsMs}ms` : '')}
                </span>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-200">{net.aiSummary}</p>
            </div>

            {/* What Was Fixed */}
            {net.whatWasFixed.length > 0 && (
              <div className="rounded-xl border border-[#34d399]/25 bg-black/70 p-2">
                <div className="mb-1 text-[9px] font-extrabold tracking-wider text-[#34d399] uppercase">
                  ✓ What Was Fixed
                </div>
                <div className="space-y-1 text-[9.5px] text-zinc-200">
                  {net.whatWasFixed.map((item, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#34d399]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Problems Found */}
            {net.problemsFound.length > 0 && (
              <div className="rounded-xl border border-[#fbbf24]/30 bg-black/70 p-2">
                <div className="mb-1 text-[9px] font-extrabold tracking-wider text-[#fbbf24] uppercase">
                  ! What Is Slowing Your Internet Down
                </div>
                <div className="space-y-1 text-[9.5px] text-zinc-200">
                  {net.problemsFound.map((p, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#fbbf24]" />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Easy Next Steps */}
            {net.aiTips.length > 0 && (
              <div className="rounded-xl border border-[#22d3ee]/25 bg-black/70 p-2">
                <div className="mb-1 text-[9px] font-extrabold tracking-wider text-[#22d3ee] uppercase">
                  What You Should Do To Make It Faster
                </div>
                <div className="space-y-1 text-[9.5px] text-zinc-200">
                  {net.aiTips.map((tip, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span className="font-mono-tech font-extrabold text-[#22d3ee]">
                        {idx + 1}.
                      </span>
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {rightTab === 'log' && (
          <div className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#040508] p-2 text-[8.5px] leading-relaxed text-[#d4f5e9]">
            {net.fixLog.length > 0 ? (
              net.fixLog.map((line, i) => <div key={i}>{line}</div>)
            ) : (
              <div className="grid h-full place-items-center text-zinc-500">
                Live DNS boost, speed test &amp; DHCP logs appear here.
              </div>
            )}
          </div>
        )}

        {/* Quick 1-Tap Network Boost & Fix Bar (pixel-aligned h-8) */}
        <div className="grid grid-cols-4 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => runFix('boost_dns')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#34d399]/35 bg-[#34d399]/12 text-[8.5px] font-extrabold whitespace-nowrap text-[#34d399] disabled:opacity-40"
          >
            <Zap className="h-3 w-3 shrink-0" />
            1.1.1.1 DNS
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => runFix('flush_dns')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#22d3ee]/35 bg-[#22d3ee]/12 text-[8.5px] font-extrabold whitespace-nowrap text-[#22d3ee] disabled:opacity-40"
          >
            <Activity className="h-3 w-3 shrink-0" />
            FLUSH DNS
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => runFix('renew_dhcp')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#fbbf24]/35 bg-[#fbbf24]/12 text-[8.5px] font-extrabold whitespace-nowrap text-[#fbbf24] disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3 shrink-0" />
            RENEW IP
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            disabled={busy}
            onClick={() => runFix('ai_analyze')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/12 text-[8.5px] font-extrabold whitespace-nowrap text-[#c4b5fd] disabled:opacity-40"
          >
            <Sparkles className="h-3 w-3 shrink-0" />
            AI ANALYZE
          </motion.button>
        </div>
      </div>
    </div>
  );
}
