'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
  Network,
  Radio,
  RefreshCw,
  Router,
  Search,
  Server,
  Shield,
  Smartphone,
  Sparkles,
  Terminal,
  Wifi,
  Zap,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import { InstrumentGauge } from '@/components/shell/InstrumentGauge';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { bridgeRequest } from '@/lib/bridgeRequest';
import { makeRequestId } from '@/lib/formatters';
import {
  runPhoneDirectProbe,
  runPhoneDirectScan,
  runPhoneDirectSpeedTest,
} from '@/lib/phoneNetworkScanner';
import { soundEngine } from '@/lib/soundEngine';
import type {
  NetOpsHopMetric,
  NetOpsProbeResult,
  NetworkCommandState,
  NetworkFixAction,
} from '@/types/protocol';

type RightTabId = 'overview' | 'devices' | 'tools' | 'log';

function gradeBadgeStyle(grade: string): { bg: string; fg: string; label: string } {
  if (grade === 'ULTRA') return { bg: 'rgba(136,241,209,0.18)', fg: '#88f1d1', label: 'ULTRA' };
  if (grade === 'FAST') return { bg: 'rgba(56,189,248,0.18)', fg: '#7dd3fc', label: 'FAST' };
  if (grade === 'FAIR') return { bg: 'rgba(251,191,36,0.18)', fg: '#fbbf24', label: 'FAIR' };
  if (grade === 'SLOW') return { bg: 'rgba(255,93,108,0.2)', fg: '#ff5d6c', label: 'SLOW' };
  return { bg: 'rgba(156,180,187,0.16)', fg: '#9cb4bb', label: 'READY' };
}

function hopColor(status: NetOpsHopMetric['status']): string {
  if (status === 'ok') return '#88f1d1';
  if (status === 'warn') return '#fbbf24';
  if (status === 'bad') return '#ff5d6c';
  return '#78959e';
}

export function NetworkCommandView({ deck }: { deck: DevDeckState }) {
  const uid = useId();
  const [rightTab, setRightTab] = useState<RightTabId>('overview');
  const [showPass, setShowPass] = useState(false);
  const [sourcePref, setSourcePref] = useState<'auto' | 'phone'>('auto');
  const [phoneNet, setPhoneNet] = useState<NetworkCommandState>(deck.networkState);
  const [bridgeOverride, setBridgeOverride] = useState<NetworkCommandState | null>(null);

  // Interactive Diagnostic Workbench state (Ping / DNS / Port Scan)
  const [probeTarget, setProbeTarget] = useState('1.1.1.1');
  const [probingMode, setProbingMode] = useState<'ping' | 'dns' | 'ports' | null>(null);
  const [probeResult, setProbeResult] = useState<NetOpsProbeResult | null>(null);

  const autoScannedRef = useRef(false);
  const tabRefs = useRef<Record<RightTabId, HTMLButtonElement | null>>({
    overview: null,
    devices: null,
    tools: null,
    log: null,
  });

  const bridgeConnected = deck.status === 'connected';
  const usePhoneDirect = !bridgeConnected || sourcePref === 'phone';

  // Keep bridgeOverride synced whenever live WS pushes fresher telemetry
  useEffect(() => {
    if (
      deck.networkState.updatedAt > 0 ||
      deck.networkState.scanning ||
      deck.networkState.testingSpeed ||
      deck.networkState.fixing
    ) {
      setBridgeOverride(null);
    }
  }, [
    deck.networkState.updatedAt,
    deck.networkState.scanning,
    deck.networkState.testingSpeed,
    deck.networkState.fixing,
    deck.networkState.downMbps,
    deck.networkState.upMbps,
  ]);

  const net = usePhoneDirect ? phoneNet : (bridgeOverride ?? deck.networkState);
  const gradeStyle = gradeBadgeStyle(net.grade);
  const busy = net.scanning || net.testingSpeed || net.fixing;

  const selectTab = (id: RightTabId) => {
    soundEngine.playClick();
    setRightTab(id);
    requestAnimationFrame(() => {
      tabRefs.current[id]?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    });
  };

  // Run initial scan automatically on mount so NetOps Pro immediately populates live data
  useEffect(() => {
    if (autoScannedRef.current) return;
    if (net.updatedAt === 0 && !net.scanning) {
      autoScannedRef.current = true;
      if (usePhoneDirect) {
        void runPhoneDirectScan(setPhoneNet);
      } else {
        void triggerScan(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConnected, usePhoneDirect]);

  const triggerScan = async (silent = false) => {
    if (!silent) soundEngine.playClick();
    if (usePhoneDirect) {
      await runPhoneDirectScan(setPhoneNet);
      return;
    }
    try {
      const res = await bridgeRequest<{ ok: boolean; state: NetworkCommandState }>(
        deck,
        'netops/scan',
        {},
      );
      if (res?.state) setBridgeOverride(res.state);
    } catch {
      const sent = deck.sendEvent({ type: 'network:scan', payload: { requestId: makeRequestId() } });
      if (!sent) {
        await runPhoneDirectScan(setPhoneNet);
      }
    }
  };

  const triggerSpeedTest = async () => {
    soundEngine.playClick();
    setRightTab('overview');
    if (usePhoneDirect) {
      await runPhoneDirectSpeedTest(setPhoneNet);
      return;
    }
    try {
      const res = await bridgeRequest<{ ok: boolean; state: NetworkCommandState }>(
        deck,
        'netops/speedtest',
        {},
      );
      if (res?.state) setBridgeOverride(res.state);
    } catch {
      const sent = deck.sendEvent({
        type: 'network:speedtest',
        payload: { requestId: makeRequestId() },
      });
      if (!sent) {
        await runPhoneDirectSpeedTest(setPhoneNet);
      }
    }
  };

  const triggerFix = async (action: NetworkFixAction) => {
    soundEngine.playClick();
    if (action === 'ai_analyze' || action === 'full_net_fix') setRightTab('overview');
    else setRightTab('log');

    if (usePhoneDirect) {
      if (action === 'full_net_fix' || action === 'ai_analyze') {
        await runPhoneDirectSpeedTest(setPhoneNet);
        return;
      }
      setRightTab('overview');
      const tip =
        action === 'boost_dns'
          ? 'iPhone Fast DNS: Settings → Wi-Fi → tap (i) → Configure DNS → Manual → add 1.1.1.1 & 8.8.8.8.'
          : action === 'flush_dns'
            ? 'iPhone DNS Flush: Toggle Airplane Mode ON for 5 seconds, then OFF to clear cached records.'
            : 'iPhone DHCP Renew: Settings → Wi-Fi → tap (i) → tap "Renew Lease" for a fresh local IP.';
      setPhoneNet((prev) => ({
        ...prev,
        whatWasFixed: [tip, ...prev.whatWasFixed.filter((t) => t !== tip)].slice(0, 4),
        fixLog: [...prev.fixLog.slice(-60), `[Phone-Direct] ${tip}`],
      }));
      deck.showToast(true, 'iPhone network action guide added');
      return;
    }

    try {
      const res = await bridgeRequest<{
        ok: boolean;
        message: string;
        state: NetworkCommandState;
      }>(deck, 'netops/fix', { action });
      if (res?.state) setBridgeOverride(res.state);
      if (res?.message) deck.showToast(true, res.message);
    } catch {
      deck.sendEvent({ type: 'network:fix', payload: { requestId: makeRequestId(), action } });
    }
  };

  const executeProbe = async (mode: 'ping' | 'dns' | 'ports', overrideTarget?: string) => {
    const cleanTarget = (overrideTarget ?? probeTarget).trim();
    if (!cleanTarget || probingMode) return;
    if (overrideTarget) setProbeTarget(cleanTarget);
    setRightTab('tools');
    setProbingMode(mode);
    soundEngine.playClick();

    try {
      let result: NetOpsProbeResult;
      if (usePhoneDirect) {
        result = await runPhoneDirectProbe(mode, cleanTarget);
      } else {
        try {
          result = await bridgeRequest<NetOpsProbeResult>(deck, 'netops/probe', {
            mode,
            target: cleanTarget,
          });
        } catch {
          result = await runPhoneDirectProbe(mode, cleanTarget);
        }
      }
      setProbeResult(result);
    } catch (err) {
      deck.showToast(false, err instanceof Error ? err.message : 'Diagnostic probe failed');
    } finally {
      setProbingMode(null);
    }
  };

  const handleRevealPassword = () => {
    soundEngine.playClick();
    if (usePhoneDirect) {
      deck.showToast(false, 'Switch to Host PC mode to read saved Keychain Wi-Fi password');
      return;
    }
    if (net.wifiPassword) {
      setShowPass((v) => !v);
      return;
    }
    setShowPass(true);
    deck.sendEvent({ type: 'network:wifiPassword', payload: { requestId: makeRequestId() } });
  };

  const isUploading = net.testingSpeed && net.speedPhase === 'upload';
  const activeGaugeMbps = isUploading ? net.upMbps : net.downMbps;
  const speedMax = Math.max(250, Math.ceil((activeGaugeMbps ?? 0) / 250) * 250);
  const usingFastDns = net.dnsServers.some(
    (d) => d === '1.1.1.1' || d === '8.8.8.8' || d.includes('1.1.1.1'),
  );

  const fallbackHops: NetOpsHopMetric[] =
    net.hops && net.hops.length > 0
      ? net.hops
      : [
          ...(usePhoneDirect
            ? []
            : [
                {
                  id: 'gw',
                  label: 'Wi-Fi Router',
                  target: net.gatewayIp || 'Local GW',
                  latencyMs: net.gatewayPingMs ?? null,
                  status:
                    net.gatewayPingMs != null
                      ? net.gatewayPingMs > 35
                        ? ('warn' as const)
                        : ('ok' as const)
                      : ('idle' as const),
                },
              ]),
          {
            id: 'cf',
            label: net.colo ? `Cloudflare (${net.colo})` : 'Cloudflare Edge',
            target: '1.1.1.1',
            latencyMs: net.pingMs,
            status:
              net.pingMs != null
                ? net.pingMs > 110
                  ? 'bad'
                  : net.pingMs > 50
                    ? 'warn'
                    : 'ok'
                : 'idle',
          },
          {
            id: 'dns',
            label: 'DNS Lookup',
            target: net.dnsServers[0] || 'Resolver',
            latencyMs: net.dnsMs,
            status:
              net.dnsMs != null
                ? net.dnsMs > 95
                  ? 'bad'
                  : net.dnsMs > 45
                    ? 'warn'
                    : 'ok'
                : 'idle',
          },
        ];

  const tabItems: Array<{ id: RightTabId; label: string; Icon: typeof Sparkles }> = [
    { id: 'overview', label: 'Overview', Icon: Sparkles },
    { id: 'devices', label: `LAN (${net.devices.length})`, Icon: Radio },
    { id: 'tools', label: 'Tools', Icon: Search },
    { id: 'log', label: `Log (${net.fixLog.length})`, Icon: Terminal },
  ];

  return (
    <div className="screen-grid layout-network">
      {/* LEFT TILE: Live Streaming Automotive Speedometer + Identity + Primary Controls */}
      <div className="tile flex min-h-0 flex-col justify-between gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-[#88f1d1]" />

        {/* Header + Source Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Wifi aria-hidden="true" className="h-4 w-4 text-[#88f1d1]" />
            <h2 className="disp text-[19px]">NetOps Pro</h2>
          </div>

          <div className="flex items-center gap-1">
            {bridgeConnected ? (
              <div
                className="flex rounded-xl border border-[#98c8ce29] bg-[#0a151c] p-0.5"
                role="group"
                aria-label="Telemetry source"
              >
                <button
                  type="button"
                  aria-pressed={!usePhoneDirect}
                  onClick={() => {
                    soundEngine.playClick();
                    setSourcePref('auto');
                  }}
                  className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[9px] font-extrabold uppercase"
                  style={{
                    background: !usePhoneDirect ? '#153137' : 'transparent',
                    color: !usePhoneDirect ? '#88f1d1' : '#9cb4bb',
                  }}
                >
                  <Laptop aria-hidden="true" className="h-2.5 w-2.5" />
                  Host
                </button>
                <button
                  type="button"
                  aria-pressed={usePhoneDirect}
                  onClick={() => {
                    soundEngine.playClick();
                    setSourcePref('phone');
                    if (phoneNet.updatedAt === 0 && !phoneNet.scanning) {
                      void runPhoneDirectScan(setPhoneNet);
                    }
                  }}
                  className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[9px] font-extrabold uppercase"
                  style={{
                    background: usePhoneDirect ? '#153137' : 'transparent',
                    color: usePhoneDirect ? '#88f1d1' : '#9cb4bb',
                  }}
                >
                  <Smartphone aria-hidden="true" className="h-2.5 w-2.5" />
                  iPhone
                </button>
              </div>
            ) : (
              <span className="rounded-full border border-[#88f1d1]/30 bg-[#88f1d1]/12 px-2 py-0.5 text-[8.5px] font-extrabold text-[#88f1d1] uppercase">
                iPhone Direct
              </span>
            )}

            {net.vpnActive && (
              <span className="flex items-center gap-0.5 rounded-full bg-[#7dd3fc]/16 px-1.5 py-0.5 text-[8.5px] font-extrabold text-[#7dd3fc]">
                <Shield aria-hidden="true" className="h-2.5 w-2.5" />
                VPN
              </span>
            )}

            <span
              className="font-mono-tech rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
              style={{ background: gradeStyle.bg, color: gradeStyle.fg }}
            >
              {gradeStyle.label}
            </span>
          </div>
        </div>

        {/* Live Streaming Automotive Speedometer + 4-Cell Readout */}
        <div className="flex items-center gap-2.5 rounded-2xl border border-[#98c8ce24] bg-[#0a151c] p-2">
          <InstrumentGauge
            className="instrument-summary"
            mode="speed"
            label={isUploading ? 'Upload' : 'Download'}
            unit="Mbps"
            value={activeGaugeMbps}
            max={speedMax}
            accent={isUploading ? '#7dd3fc' : '#88f1d1'}
            status={
              net.testingSpeed
                ? net.speedPhase === 'upload'
                  ? 'UL LIVE'
                  : net.speedPhase === 'download'
                    ? 'DL LIVE'
                    : 'PING…'
                : undefined
            }
          />

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
            <div className="rounded-xl border border-[#98c8ce1c] bg-[#101d25] px-2 py-1">
              <div className="text-[8px] font-bold tracking-wider text-[#9cb4bb] uppercase">
                Download
              </div>
              <div className="num font-mono-tech text-console-caption font-extrabold text-[#88f1d1]">
                {net.downMbps !== null ? `${net.downMbps}M` : '--'}
              </div>
            </div>
            <div className="rounded-xl border border-[#98c8ce1c] bg-[#101d25] px-2 py-1">
              <div className="text-[8px] font-bold tracking-wider text-[#9cb4bb] uppercase">
                Upload
              </div>
              <div className="num font-mono-tech text-console-caption font-extrabold text-[#7dd3fc]">
                {net.upMbps !== null ? `${net.upMbps}M` : '--'}
              </div>
            </div>
            <div className="rounded-xl border border-[#98c8ce1c] bg-[#101d25] px-2 py-1">
              <div className="text-[8px] font-bold tracking-wider text-[#9cb4bb] uppercase">
                Ping RTT
              </div>
              <div className="num font-mono-tech text-console-caption font-extrabold text-[#effaf7]">
                {net.pingMs !== null ? `${net.pingMs}ms` : '--'}
              </div>
            </div>
            <div className="rounded-xl border border-[#98c8ce1c] bg-[#101d25] px-2 py-1">
              <div className="text-[8px] font-bold tracking-wider text-[#9cb4bb] uppercase">
                Jitter · Loss
              </div>
              <div className="num font-mono-tech truncate text-console-caption font-extrabold text-[#fbbf24]">
                {net.jitterMs !== null ? `${net.jitterMs}ms` : '--'}
                {net.packetLossPct ? ` · ${net.packetLossPct}%` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Link Identity, Copyable Public IP & Keychain Wi-Fi Password */}
        <div className="min-h-0 flex-1 space-y-1.5 rounded-2xl border border-[#98c8ce24] bg-[#0a151c] p-2.5 text-console-caption">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-extrabold text-[#effaf7]">{net.ssid}</span>
              {net.signalDbm !== null && (
                <span className="font-mono-tech shrink-0 rounded bg-[#153137] px-1.5 py-0.5 text-[8px] font-bold text-[#88f1d1]">
                  {net.signalDbm} dBm
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <span className="font-mono-tech text-console-micro font-bold text-[#88f1d1]">
                {net.publicIp || '--'}
              </span>
              {net.publicIp && net.publicIp !== '--' && (
                <button
                  type="button"
                  aria-label="Copy public IP address"
                  onClick={() => {
                    soundEngine.playClick();
                    void navigator.clipboard?.writeText(net.publicIp);
                    deck.showToast(true, `Copied IP: ${net.publicIp}`);
                  }}
                  className="grid min-h-[24px] min-w-[24px] place-items-center rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] text-[#9cb4bb]"
                >
                  <Copy aria-hidden="true" className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          </div>

          <div className="font-mono-tech flex items-center justify-between gap-1.5 text-console-micro text-[#9cb4bb]">
            <span className="truncate">
              DNS: {net.dnsServers.join(', ') || '--'}
              {usingFastDns && (
                <strong className="ml-1 text-[#88f1d1]">· FAST</strong>
              )}
            </span>
            <span className="shrink-0">GW: {net.gatewayIp || '--'}</span>
          </div>

          {/* Wi-Fi Password Reveal Row */}
          <div className="flex items-center justify-between gap-1.5 rounded-xl border border-[#98c8ce20] bg-[#101d25] px-2 py-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <KeyRound aria-hidden="true" className="h-3 w-3 shrink-0 text-[#fbbf24]" />
              <span className="font-mono-tech truncate text-console-caption font-bold text-[#effaf7]">
                {net.wifiPassword
                  ? showPass
                    ? net.wifiPassword
                    : '••••••••••••'
                  : net.wifiPasswordNote || 'Saved Wi-Fi Key'}
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
                  className="grid min-h-[24px] min-w-[24px] place-items-center rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] text-[#effaf7]"
                  aria-label="Copy Wi-Fi password"
                >
                  <Copy aria-hidden="true" className="h-2.5 w-2.5" />
                </button>
              )}
              <button
                type="button"
                onClick={handleRevealPassword}
                className="flex min-h-[24px] items-center gap-1 rounded-lg border border-[#fbbf24]/35 bg-[#fbbf24]/14 px-2 py-0.5 text-console-micro font-extrabold text-[#fbbf24]"
              >
                {showPass && net.wifiPassword ? (
                  <>
                    <EyeOff aria-hidden="true" className="h-2.5 w-2.5" /> Hide
                  </>
                ) : (
                  <>
                    <Eye aria-hidden="true" className="h-2.5 w-2.5" /> Reveal
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Primary Controls */}
        <div className="grid grid-cols-5 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={DECK_SPRING}
            disabled={busy}
            onClick={() => void triggerSpeedTest()}
            className="col-span-2 flex h-8 items-center justify-center gap-1 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-console-caption font-extrabold whitespace-nowrap text-[#effaf7] disabled:opacity-40"
          >
            <Gauge
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 text-[#88f1d1] ${net.testingSpeed ? 'animate-spin' : ''}`}
            />
            {net.testingSpeed ? 'LIVE…' : 'SPEED'}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={DECK_SPRING}
            disabled={busy}
            onClick={() => void triggerFix('full_net_fix')}
            className="col-span-3 flex h-8 items-center justify-center gap-1 rounded-xl bg-[#88f1d1] text-console-caption font-extrabold whitespace-nowrap text-[#08221c] disabled:opacity-40"
          >
            <Zap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            BOOST &amp; FIX
          </motion.button>
        </div>
      </div>

      {/* RIGHT TILE: 4-Tab NOC Workbench (Overview · LAN Radar · Tools · Log) */}
      <div className="tile flex min-h-0 flex-col gap-2 p-3">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-[#88f1d1]" />

        {/* Single-Row Accessible Tablist + Separate Sweep Button */}
        <div className="flex items-center justify-between gap-1.5">
          <div
            role="tablist"
            aria-label="NetOps diagnostic views"
            className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-xl border border-[#98c8ce29] bg-[#0a151c] px-1 py-0.5"
          >
            {tabItems.map(({ id, label, Icon }) => {
              const selected = rightTab === id;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${id}`}
                  aria-selected={selected}
                  onClick={() => selectTab(id)}
                  className="relative flex flex-none items-center gap-1 px-2.5 py-1 text-console-micro font-extrabold whitespace-nowrap uppercase transition-colors"
                  style={{
                    color: selected ? '#88f1d1' : '#9cb4bb',
                  }}
                >
                  <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                  <span>{label}</span>
                  {selected && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-1.5 bottom-0 border-b-2 border-[#88f1d1]"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Placed outside role="tablist" so tablist only contains role="tab" elements */}
          <button
            type="button"
            disabled={busy}
            onClick={() => void triggerScan(false)}
            className="flex min-h-[28px] shrink-0 items-center gap-1 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] px-2.5 py-1 text-console-micro font-extrabold text-[#effaf7] uppercase disabled:opacity-40"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-2.5 w-2.5 text-[#88f1d1] ${net.scanning ? 'animate-spin' : ''}`}
            />
            {net.scanning ? 'Sweep…' : 'Sweep'}
          </button>
        </div>

        {/* Tab Panels Container (single flex-1 slot, initial hidden state on inactive panels) */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {/* PANEL 1: OVERVIEW (Multi-Hop Matrix + NOC Diagnosis) */}
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-overview`}
            hidden={rightTab !== 'overview'}
            className="h-full"
          >
            <div className="deck-scroll flex h-full flex-col gap-2 overflow-y-auto pr-0.5">
              {busy && net.activeAction && (
                <div
                  role="progressbar"
                  aria-label={net.activeAction}
                  className="flex items-center gap-2 rounded-xl border border-[#88f1d1]/40 bg-[#88f1d1]/12 px-2.5 py-1.5 text-console-caption font-bold text-[#88f1d1]"
                >
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span className="truncate">{net.activeAction}</span>
                </div>
              )}

              {/* Live Multi-Hop Latency Matrix */}
              <div className="rounded-2xl border border-[#98c8ce24] bg-[#0a151c] p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[9.5px] font-extrabold tracking-wider text-[#88f1d1] uppercase">
                    <Network aria-hidden="true" className="h-3 w-3" />
                    Multi-Hop Latency Path
                  </span>
                  <span className="font-mono-tech truncate text-[9px] text-[#9cb4bb]">
                    {net.isp || 'Tap any hop to probe'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {fallbackHops.map((hop) => {
                    const col = hopColor(hop.status);
                    const pct =
                      hop.latencyMs !== null ? Math.max(8, Math.min(100, (hop.latencyMs / 120) * 100)) : 0;
                    return (
                      <button
                        key={hop.id}
                        type="button"
                        onClick={() => void executeProbe('ping', hop.target)}
                        aria-label={`Probe ${hop.label} (${hop.target})`}
                        className="rounded-xl border border-[#98c8ce1f] bg-[#101d25] px-2 py-1.5 text-left transition-colors hover:border-[#88f1d1]/45"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-[9.5px] font-bold text-[#effaf7]">
                            {hop.label}
                          </span>
                          <span
                            className="font-mono-tech shrink-0 text-[9.5px] font-extrabold"
                            style={{ color: col }}
                          >
                            {hop.latencyMs !== null ? `${hop.latencyMs}ms` : '--'}
                          </span>
                        </div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#091319]">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{ width: `${pct}%`, background: col }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Plain-English NOC Summary */}
              <div className="rounded-2xl border border-[#98c8ce24] bg-[#0a151c] p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-console-caption font-extrabold tracking-wider text-[#88f1d1] uppercase">
                    <Sparkles aria-hidden="true" className="h-3 w-3" />
                    Network Health Verdict
                  </span>
                  {net.dnsMs !== null && (
                    <span className="font-mono-tech text-console-micro text-[#9cb4bb]">
                      DNS {net.dnsMs}ms
                    </span>
                  )}
                </div>
                <p className="text-console-caption leading-relaxed text-[#effaf7]/90">
                  {net.aiSummary}
                </p>
              </div>

              {/* Verified Fixes */}
              {net.whatWasFixed.length > 0 && (
                <div className="rounded-2xl border border-[#88f1d1]/30 bg-[#0a151c] p-2">
                  <div className="mb-1 text-console-micro font-extrabold tracking-wider text-[#88f1d1] uppercase">
                    ✓ Verified Optimizations
                  </div>
                  <ul role="list" className="space-y-1 text-console-caption text-[#effaf7]/90">
                    {net.whatWasFixed.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span
                          aria-hidden="true"
                          className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#88f1d1]"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Detected Bottlenecks */}
              {net.problemsFound.length > 0 && (
                <div className="rounded-2xl border border-[#fbbf24]/30 bg-[#0a151c] p-2">
                  <div className="mb-1 text-console-micro font-extrabold tracking-wider text-[#fbbf24] uppercase">
                    ! Active Bottlenecks
                  </div>
                  <ul role="list" className="space-y-1 text-console-caption text-[#effaf7]/90">
                    {net.problemsFound.map((p, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span
                          aria-hidden="true"
                          className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#fbbf24]"
                        />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommended Actions */}
              {net.aiTips.length > 0 && (
                <div className="rounded-2xl border border-[#98c8ce24] bg-[#0a151c] p-2">
                  <div className="mb-1 text-console-micro font-extrabold tracking-wider text-[#7dd3fc] uppercase">
                    Recommended Next Steps
                  </div>
                  <ol role="list" className="space-y-1 text-console-caption text-[#effaf7]/90">
                    {net.aiTips.map((tip, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="font-mono-tech font-extrabold text-[#88f1d1]">
                          {idx + 1}.
                        </span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>

          {/* PANEL 2: LAN RADAR (Active /24 Subnet Discovery + 1-Tap Device Probe) */}
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-devices`}
            hidden={rightTab !== 'devices'}
            className="h-full"
          >
            <div className="deck-scroll flex h-full flex-col gap-1.5 overflow-y-auto pr-0.5">
              {net.devices.map((dev) => {
                const color = dev.isGateway ? '#fbbf24' : dev.isSelf ? '#88f1d1' : '#7dd3fc';
                const Icon = dev.isGateway ? Router : dev.isSelf ? Laptop : Globe;
                return (
                  <div
                    key={`${dev.ip}-${dev.mac}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[#98c8ce22] bg-[#0a151c] px-2.5 py-1.5"
                    style={{ borderLeftWidth: 2.5, borderLeftColor: color }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-console-caption font-extrabold text-[#effaf7]">
                            {dev.hostname}
                          </span>
                          {dev.isNew && (
                            <span className="rounded bg-[#fbbf24]/20 px-1 text-[8px] font-extrabold text-[#fbbf24]">
                              NEW
                            </span>
                          )}
                          {dev.isGateway && (
                            <span className="rounded bg-[#fbbf24]/18 px-1 text-[8px] font-extrabold text-[#fbbf24]">
                              ROUTER
                            </span>
                          )}
                          {dev.isSelf && (
                            <span className="rounded bg-[#88f1d1]/18 px-1 text-[8px] font-extrabold text-[#88f1d1]">
                              SELF
                            </span>
                          )}
                        </div>
                        <div className="font-mono-tech truncate text-console-micro text-[#9cb4bb]">
                          {dev.vendor} · {dev.mac}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="text-right">
                        <div className="font-mono-tech text-console-caption font-bold text-[#88f1d1]">
                          {dev.ip}
                        </div>
                        {dev.latencyMs != null && (
                          <div className="font-mono-tech text-[8.5px] text-[#9cb4bb]">
                            {dev.latencyMs}ms
                          </div>
                        )}
                      </div>
                      {!dev.isSelf && /^\d+\.\d+\.\d+\.\d+$/.test(dev.ip) && (
                        <button
                          type="button"
                          onClick={() => void executeProbe('ports', dev.ip)}
                          aria-label={`Scan ports on ${dev.hostname} (${dev.ip})`}
                          className="min-h-[26px] rounded-lg border border-[#b3e5df36] bg-[#bcfff20d] px-2 text-[8.5px] font-extrabold text-[#88f1d1] uppercase"
                        >
                          Probe
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {net.devices.length === 0 && (
                <div className="grid h-full place-items-center rounded-2xl border border-[#98c8ce20] bg-[#0a151c] p-4 text-center">
                  <div className="sub">
                    Tap &quot;Sweep&quot; to discover active devices on your Wi-Fi subnet.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PANEL 3: INTERACTIVE DIAGNOSTIC TOOLS (Ping · DNS Inspector · 14-Port TCP Scanner) */}
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-tools`}
            hidden={rightTab !== 'tools'}
            className="h-full"
          >
            <div className="deck-scroll flex h-full flex-col gap-2 overflow-y-auto pr-0.5">
              <div className="space-y-1.5 rounded-2xl border border-[#98c8ce24] bg-[#0a151c] p-2.5">
                <div className="flex items-center justify-between gap-1.5">
                  <label
                    htmlFor={`${uid}-probe-host`}
                    className="text-[9.5px] font-extrabold tracking-wider text-[#88f1d1] uppercase"
                  >
                    Target Hostname or IPv4
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {[
                      '1.1.1.1',
                      'github.com',
                      'google.com',
                      ...(net.gatewayIp && /^\d+\./.test(net.gatewayIp) ? [net.gatewayIp] : []),
                      ...(!usePhoneDirect ? ['127.0.0.1'] : []),
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          soundEngine.playClick();
                          setProbeTarget(preset);
                        }}
                        className="font-mono-tech rounded-md border border-[#98c8ce24] bg-[#101d25] px-1.5 py-0.5 text-[8.5px] font-bold text-[#9cb4bb] hover:text-[#88f1d1]"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    id={`${uid}-probe-host`}
                    type="text"
                    value={probeTarget}
                    onChange={(e) => setProbeTarget(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="e.g. github.com or 192.168.1.1"
                    className="font-mono-tech h-8 min-w-0 flex-1 rounded-xl border border-[#98c8ce2e] bg-[#101d25] px-2.5 text-[11px] font-bold text-[#effaf7] outline-none focus:border-[#88f1d1]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    disabled={probingMode !== null}
                    onClick={() => void executeProbe('ping')}
                    className="flex min-h-[30px] items-center justify-center gap-1 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-[9.5px] font-extrabold text-[#effaf7] uppercase disabled:opacity-40"
                  >
                    {probingMode === 'ping' ? (
                      <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin text-[#88f1d1]" />
                    ) : (
                      <Activity aria-hidden="true" className="h-3 w-3 text-[#88f1d1]" />
                    )}
                    Ping / HTTP
                  </button>
                  <button
                    type="button"
                    disabled={probingMode !== null}
                    onClick={() => void executeProbe('dns')}
                    className="flex min-h-[30px] items-center justify-center gap-1 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-[9.5px] font-extrabold text-[#effaf7] uppercase disabled:opacity-40"
                  >
                    {probingMode === 'dns' ? (
                      <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin text-[#7dd3fc]" />
                    ) : (
                      <Globe aria-hidden="true" className="h-3 w-3 text-[#7dd3fc]" />
                    )}
                    DNS Lookup
                  </button>
                  <button
                    type="button"
                    disabled={probingMode !== null}
                    onClick={() => void executeProbe('ports')}
                    className="flex min-h-[30px] items-center justify-center gap-1 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-[9.5px] font-extrabold text-[#effaf7] uppercase disabled:opacity-40"
                  >
                    {probingMode === 'ports' ? (
                      <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin text-[#fbbf24]" />
                    ) : (
                      <Server aria-hidden="true" className="h-3 w-3 text-[#fbbf24]" />
                    )}
                    Port Scan
                  </button>
                </div>
              </div>

              {/* Diagnostic Result Output */}
              {probeResult ? (
                <div className="space-y-1.5 rounded-2xl border border-[#98c8ce24] bg-[#0a151c] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-tech text-[9.5px] font-extrabold text-[#88f1d1] uppercase">
                      {probeResult.mode.toUpperCase()} · {probeResult.target}
                      {probeResult.resolvedIp && probeResult.resolvedIp !== probeResult.target
                        ? ` (${probeResult.resolvedIp})`
                        : ''}
                    </span>
                    <span className="rounded bg-[#153137] px-1.5 py-0.5 text-[8px] font-extrabold text-[#9cb4bb] uppercase">
                      {probeResult.source === 'bridge' ? 'Host Engine' : 'Phone DoH'}
                    </span>
                  </div>

                  <p className="text-console-caption leading-snug text-[#effaf7]/90">
                    {probeResult.summary}
                  </p>

                  {probeResult.ping && (
                    <div className="grid grid-cols-4 gap-1 pt-0.5">
                      <div className="rounded-lg bg-[#101d25] px-2 py-1">
                        <div className="text-[8px] text-[#9cb4bb]">AVG RTT</div>
                        <div className="font-mono-tech text-[10.5px] font-extrabold text-[#88f1d1]">
                          {probeResult.ping.avgMs !== null ? `${probeResult.ping.avgMs}ms` : '--'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#101d25] px-2 py-1">
                        <div className="text-[8px] text-[#9cb4bb]">MIN / MAX</div>
                        <div className="font-mono-tech text-[10.5px] font-extrabold text-[#effaf7]">
                          {probeResult.ping.minMs ?? '--'}/{probeResult.ping.maxMs ?? '--'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#101d25] px-2 py-1">
                        <div className="text-[8px] text-[#9cb4bb]">JITTER</div>
                        <div className="font-mono-tech text-[10.5px] font-extrabold text-[#fbbf24]">
                          {probeResult.ping.jitterMs !== null
                            ? `${probeResult.ping.jitterMs}ms`
                            : '--'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#101d25] px-2 py-1">
                        <div className="text-[8px] text-[#9cb4bb]">LOSS</div>
                        <div
                          className="font-mono-tech text-[10.5px] font-extrabold"
                          style={{
                            color: probeResult.ping.lossPct > 0 ? '#ff5d6c' : '#88f1d1',
                          }}
                        >
                          {probeResult.ping.lossPct}%
                        </div>
                      </div>
                    </div>
                  )}

                  {probeResult.dns && (
                    <div className="space-y-1 pt-0.5">
                      {probeResult.dns.records.map((r, i) => (
                        <div
                          key={`${r.type}-${r.value}-${i}`}
                          className="flex items-center justify-between gap-2 rounded-lg bg-[#101d25] px-2 py-1"
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="font-mono-tech shrink-0 rounded bg-[#153137] px-1.5 py-0.5 text-[8.5px] font-extrabold text-[#88f1d1]">
                              {r.type}
                            </span>
                            <span className="font-mono-tech truncate text-[10px] text-[#effaf7]">
                              {r.value}
                            </span>
                          </div>
                          {r.ttl !== undefined && (
                            <span className="font-mono-tech shrink-0 text-[8.5px] text-[#9cb4bb]">
                              TTL {r.ttl}s
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {probeResult.ports && (
                    <div className="grid grid-cols-3 gap-1 pt-0.5">
                      {probeResult.ports.items.map((p) => (
                        <div
                          key={p.port}
                          className="flex items-center justify-between rounded-lg border px-2 py-1"
                          style={{
                            borderColor: p.open ? 'rgba(136,241,209,0.4)' : 'rgba(152,200,206,0.12)',
                            background: p.open ? 'rgba(136,241,209,0.1)' : '#101d25',
                          }}
                        >
                          <span
                            className="font-mono-tech text-[9.5px] font-extrabold"
                            style={{ color: p.open ? '#88f1d1' : '#78959e' }}
                          >
                            {p.port}/{p.service}
                          </span>
                          <span
                            className="font-mono-tech text-[8.5px] font-bold"
                            style={{ color: p.open ? '#effaf7' : '#78959e' }}
                          >
                            {p.open ? `${p.latencyMs ?? 1}ms` : 'closed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid flex-1 place-items-center rounded-2xl border border-[#98c8ce20] bg-[#0a151c] p-3 text-center">
                  <div className="sub">
                    Run live <strong>Ping / HTTP</strong>, <strong>DNS Record Lookup</strong>, or{' '}
                    <strong>14-Port TCP Scan</strong> against any domain, router, or LAN device.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PANEL 4: LIVE NOC CONSOLE LOG */}
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-log`}
            hidden={rightTab !== 'log'}
            className="h-full"
          >
            <div className="deck-scroll font-mono-tech h-full space-y-1 overflow-y-auto rounded-2xl border border-[#98c8ce24] bg-[#071015] p-2.5 text-console-micro leading-relaxed text-[#d4f5e9]">
              {net.fixLog.length > 0 ? (
                net.fixLog.map((line, i) => <div key={i}>{line}</div>)
              ) : (
                <div className="grid h-full place-items-center text-[#9cb4bb]">
                  Live subnet sweeps, speed benchmarks, probes &amp; DNS fixes log here.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom 4-Action Quick Fix Strip */}
        <div className="grid grid-cols-4 gap-1.5">
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            disabled={busy}
            onClick={() => void triggerFix('boost_dns')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#88f1d1]/35 bg-[#88f1d1]/12 text-console-micro font-extrabold whitespace-nowrap text-[#88f1d1] disabled:opacity-40"
          >
            <Zap aria-hidden="true" className="h-3 w-3 shrink-0" />
            1.1.1.1 DNS
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            disabled={busy}
            onClick={() => void triggerFix('flush_dns')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#7dd3fc]/35 bg-[#7dd3fc]/12 text-console-micro font-extrabold whitespace-nowrap text-[#7dd3fc] disabled:opacity-40"
          >
            <Activity aria-hidden="true" className="h-3 w-3 shrink-0" />
            FLUSH DNS
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            disabled={busy}
            onClick={() => void triggerFix('renew_dhcp')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#fbbf24]/35 bg-[#fbbf24]/12 text-console-micro font-extrabold whitespace-nowrap text-[#fbbf24] disabled:opacity-40"
          >
            <RefreshCw aria-hidden="true" className="h-3 w-3 shrink-0" />
            RENEW IP
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            disabled={busy}
            onClick={() => void triggerFix('ai_analyze')}
            className="flex h-8 items-center justify-center gap-1 rounded-xl border border-[#b3e5df36] bg-[#bcfff20d] text-console-micro font-extrabold whitespace-nowrap text-[#effaf7] disabled:opacity-40"
          >
            <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-[#88f1d1]" />
            DIAGNOSE
          </motion.button>
        </div>
      </div>
    </div>
  );
}
