'use client';

import { useEffect, useState } from 'react';
import {
  Container,
  Cpu,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Send,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

interface SavedSshServer {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  identityFile?: string;
}

interface SshStats {
  ok: boolean;
  hostname: string;
  uptime: string;
  loadAvg: string;
  cpuPct: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskUsedPct: number | null;
  diskSummary: string;
  containers: Array<{ name: string; status: string; image: string }>;
  error?: string;
}

const STORAGE_SSH = 'devdeck.ssh.servers.v1';

export function SshManagerView({ deck }: { deck: DevDeckState }) {
  const [servers, setServers] = useState<SavedSshServer[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [adding, setAdding] = useState(false);

  // New server form
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [identityFile, setIdentityFile] = useState('');

  // Remote state
  const [rightTab, setRightTab] = useState<'stats' | 'terminal' | 'services'>('stats');
  const [stats, setStats] = useState<SshStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [cmdInput, setCmdInput] = useState('uname -a && uptime');
  const [runningCmd, setRunningCmd] = useState(false);
  const [termOutput, setTermOutput] = useState<string[]>([
    'Select or add an SSH server to run remote commands & monitor VPS health.',
  ]);
  const [serviceName, setServiceName] = useState('nginx');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SSH);
      if (saved) {
        const list = JSON.parse(saved) as SavedSshServer[];
        setServers(list);
        if (list[0]) setSelectedId(list[0].id);
      }
    } catch {
      // Ignore
    }
  }, []);

  const persist = (next: SavedSshServer[]) => {
    setServers(next);
    try {
      localStorage.setItem(STORAGE_SSH, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const selected = servers.find((s) => s.id === selectedId) || null;

  const saveServer = () => {
    if (!host.trim() || !username.trim()) {
      deck.showToast(false, 'Host and username are required');
      return;
    }
    soundEngine.playClick();
    const item: SavedSshServer = {
      id: String(Date.now()),
      label: label.trim() || host.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      identityFile: identityFile.trim() || undefined,
    };
    const next = [item, ...servers];
    persist(next);
    setSelectedId(item.id);
    setAdding(false);
    setLabel('');
    setHost('');
    setPort('22');
    setIdentityFile('');
  };

  const ensureBridge = (): { base: string; token: string } | null => {
    if (deck.status !== 'connected' || !deck.bridgeBaseUrl || !deck.pairing?.token) {
      deck.showToast(false, 'Pair your Mac/PC bridge to run native SSH commands');
      return null;
    }
    return { base: deck.bridgeBaseUrl, token: deck.pairing.token };
  };

  const fetchStats = async (srv = selected) => {
    if (!srv) return;
    const bridge = ensureBridge();
    if (!bridge) return;
    soundEngine.playClick();
    setLoadingStats(true);
    try {
      const res = await fetch(`${bridge.base}/api/devsuite/ssh/stats`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bridge.token}`,
        },
        body: JSON.stringify({ conn: srv }),
      });
      const data = (await res.json()) as SshStats;
      setStats(data);
      if (!data.ok && data.error) {
        deck.showToast(false, data.error.slice(0, 80));
      }
    } catch (err) {
      deck.showToast(false, err instanceof Error ? err.message : 'SSH stats failed');
    } finally {
      setLoadingStats(false);
    }
  };

  const execRemote = async (customCmd?: string) => {
    if (!selected) return;
    const bridge = ensureBridge();
    if (!bridge) return;
    const command = (customCmd ?? cmdInput).trim();
    if (!command) return;
    soundEngine.playClick();
    setRunningCmd(true);
    setTermOutput((prev) => [...prev.slice(-40), `$ ${selected.username}@${selected.host}: ${command}`]);
    try {
      const res = await fetch(`${bridge.base}/api/devsuite/ssh/exec`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bridge.token}`,
        },
        body: JSON.stringify({ conn: selected, command }),
      });
      const data = (await res.json()) as { ok: boolean; stdout: string; stderr: string };
      const lines = [data.stdout, data.stderr].filter(Boolean).join('\n').trim() || '(no output)';
      setTermOutput((prev) => [...prev.slice(-40), lines]);
    } catch (err) {
      setTermOutput((prev) => [
        ...prev.slice(-40),
        `Error: ${err instanceof Error ? err.message : 'SSH failed'}`,
      ]);
    } finally {
      setRunningCmd(false);
    }
  };

  const runServiceAction = async (
    kind: 'docker' | 'systemd',
    target: string,
    action: 'restart' | 'stop' | 'start',
  ) => {
    if (!selected || !target.trim()) return;
    const bridge = ensureBridge();
    if (!bridge) return;
    soundEngine.playClick();
    try {
      const res = await fetch(`${bridge.base}/api/devsuite/ssh/service`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bridge.token}`,
        },
        body: JSON.stringify({ conn: selected, kind, target: target.trim(), action }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      deck.showToast(data.ok, data.message);
      if (data.ok && kind === 'docker') void fetchStats(selected);
    } catch {
      deck.showToast(false, 'Service action failed');
    }
  };

  return (
    <div className="screen-grid layout-ssh">
      {/* LEFT: Saved SSH Connections */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#22d3ee] to-[#34d399]" />

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <Server className="h-4 w-4 text-[#22d3ee]" />
            <span className="disp text-[17px]">SSH Servers</span>
          </div>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setAdding((v) => !v);
            }}
            className="flex h-7 items-center gap-1 rounded-full bg-[#22d3ee] px-2.5 text-[8.5px] font-extrabold text-[#041318]"
          >
            <Plus className="h-3 w-3" />
            {adding ? 'CLOSE' : 'ADD VPS'}
          </button>
        </div>

        {adding ? (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto rounded-xl border border-white/10 bg-black/65 p-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. Prod Ubuntu VPS)"
              className="w-full rounded-lg border border-white/10 bg-[#080a10] px-2 py-1 text-[9.5px] text-white outline-none"
            />
            <div className="grid grid-cols-12 gap-1">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="user"
                className="font-mono-tech col-span-4 rounded-lg border border-white/10 bg-[#080a10] px-2 py-1 text-[9.5px] text-white outline-none"
              />
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="IP or domain"
                className="font-mono-tech col-span-5 rounded-lg border border-white/10 bg-[#080a10] px-2 py-1 text-[9.5px] text-white outline-none"
              />
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                className="font-mono-tech col-span-3 rounded-lg border border-white/10 bg-[#080a10] px-2 py-1 text-[9.5px] text-white outline-none"
              />
            </div>
            <input
              value={identityFile}
              onChange={(e) => setIdentityFile(e.target.value)}
              placeholder="SSH key path (optional, e.g. ~/.ssh/id_ed25519)"
              className="font-mono-tech w-full rounded-lg border border-white/10 bg-[#080a10] px-2 py-1 text-[9px] text-zinc-300 outline-none"
            />
            <button
              type="button"
              onClick={saveServer}
              className="h-7 w-full rounded-lg bg-[#34d399] text-[9px] font-extrabold text-[#04130c]"
            >
              SAVE CONNECTION
            </button>
          </div>
        ) : (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto pr-0.5">
            {servers.length === 0 ? (
              <div className="grid h-full place-items-center text-center text-[9.5px] text-zinc-500">
                Tap ADD VPS to save your Linux/VPS SSH servers (uses your computer&apos;s SSH keys).
              </div>
            ) : (
              servers.map((srv) => {
                const active = srv.id === selected?.id;
                return (
                  <div
                    key={srv.id}
                    onClick={() => {
                      soundEngine.playClick();
                      setSelectedId(srv.id);
                      setStats(null);
                    }}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-2.5 py-2"
                    style={{
                      background: active ? 'rgba(34,211,238,0.12)' : 'rgba(0,0,0,0.6)',
                      borderColor: active ? 'rgba(34,211,238,0.45)' : 'rgba(255,255,255,0.07)',
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-extrabold text-white">{srv.label}</div>
                      <div className="font-mono-tech truncate text-[8px] text-zinc-400">
                        {srv.username}@{srv.host}:{srv.port}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${srv.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        persist(servers.filter((x) => x.id !== srv.id));
                      }}
                      className="text-zinc-500 hover:text-[#ff5d6c]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* RIGHT: Live VPS Stats | Remote Terminal | Services & Docker */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-full bg-black/70 p-0.5">
            {(
              [
                ['stats', 'Metrics', Cpu, '#22d3ee'],
                ['terminal', 'SSH Shell', Terminal, '#34d399'],
                ['services', 'Services & Docker', Container, '#fbbf24'],
              ] as const
            ).map(([id, lbl, Icon, color]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setRightTab(id);
                }}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
                style={{
                  background: rightTab === id ? '#1f222c' : 'transparent',
                  color: rightTab === id ? color : '#7c8190',
                }}
              >
                <Icon className="h-3 w-3" />
                {lbl}
              </button>
            ))}
          </div>

          {selected && (
            <button
              type="button"
              disabled={loadingStats}
              onClick={() => void fetchStats()}
              className="flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 text-[8px] font-extrabold text-[#22d3ee]"
            >
              {loadingStats ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
              POLL VPS
            </button>
          )}
        </div>

        {rightTab === 'stats' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-2 overflow-auto">
            {!selected ? (
              <div className="grid h-full place-items-center text-[10px] text-zinc-500">
                Select an SSH server on the left to inspect CPU, RAM, Disk &amp; Uptime.
              </div>
            ) : !stats ? (
              <div className="grid h-full place-items-center text-center">
                <button
                  type="button"
                  onClick={() => void fetchStats()}
                  className="rounded-xl bg-[#22d3ee] px-4 py-2 text-[10px] font-extrabold text-[#041318]"
                >
                  Connect &amp; Poll {selected.label}
                </button>
              </div>
            ) : !stats.ok ? (
              <div className="rounded-xl border border-[#ff5d6c]/35 bg-[#ff5d6c]/10 p-3 text-[9.5px] text-[#ff5d6c]">
                {stats.error}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2.5">
                  <div className="text-[8px] text-zinc-400 uppercase">CPU / Load</div>
                  <div className="num font-mono-tech text-[15px] font-extrabold text-[#22d3ee]">
                    {stats.cpuPct !== null ? `${stats.cpuPct}%` : '--'}
                  </div>
                  <div className="font-mono-tech text-[8px] text-zinc-400">Load: {stats.loadAvg}</div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2.5">
                  <div className="text-[8px] text-zinc-400 uppercase">Memory</div>
                  <div className="num font-mono-tech text-[15px] font-extrabold text-[#34d399]">
                    {stats.ramUsedMb !== null && stats.ramTotalMb
                      ? `${Math.round((stats.ramUsedMb / stats.ramTotalMb) * 100)}%`
                      : '--'}
                  </div>
                  <div className="font-mono-tech text-[8px] text-zinc-400">
                    {stats.ramUsedMb ?? '--'} / {stats.ramTotalMb ?? '--'} MB
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2.5">
                  <div className="flex items-center gap-1 text-[8px] text-zinc-400 uppercase">
                    <HardDrive className="h-3 w-3 text-[#fbbf24]" />
                    Disk (/)
                  </div>
                  <div className="num font-mono-tech text-[13px] font-extrabold text-[#fbbf24]">
                    {stats.diskSummary}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/65 p-2.5">
                  <div className="text-[8px] text-zinc-400 uppercase">Uptime</div>
                  <div className="truncate text-[10px] font-bold text-white">{stats.uptime}</div>
                  <div className="font-mono-tech truncate text-[8px] text-zinc-400">{stats.hostname}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {rightTab === 'terminal' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2 text-[9px] whitespace-pre-wrap text-[#d4f5e9]">
              {termOutput.map((line, i) => (
                <div key={i} className={line.startsWith('$ ') ? 'font-bold text-[#22d3ee]' : ''}>
                  {line}
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void execRemote();
                }}
                spellCheck={false}
                placeholder="Remote shell command…"
                className="font-mono-tech h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9.5px] text-white outline-none"
              />
              <button
                type="button"
                disabled={runningCmd || !selected}
                onClick={() => void execRemote()}
                className="flex h-7 items-center gap-1 rounded-lg bg-[#34d399] px-2.5 text-[9px] font-extrabold text-[#04130c] disabled:opacity-40"
              >
                {runningCmd ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                RUN
              </button>
            </div>
          </div>
        )}

        {rightTab === 'services' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-2 overflow-auto">
            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.07] bg-black/60 p-2">
              <input
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="systemd service (e.g. nginx, docker, postgresql)"
                className="font-mono-tech h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9.5px] text-white outline-none"
              />
              <button
                type="button"
                disabled={!selected}
                onClick={() => void runServiceAction('systemd', serviceName, 'restart')}
                className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-[#fbbf24]/20 px-2.5 text-[8.5px] font-extrabold text-[#fbbf24] disabled:opacity-40"
              >
                <RotateCw className="h-3 w-3" />
                RESTART
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-[8px] font-extrabold text-zinc-400 uppercase">
                Remote Docker Containers ({stats?.containers.length || 0})
              </div>
              {stats?.containers.length ? (
                stats.containers.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/60 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[9.5px] font-extrabold text-white">{c.name}</div>
                      <div className="font-mono-tech truncate text-[8px] text-zinc-400">
                        {c.image} · {c.status}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runServiceAction('docker', c.name, 'restart')}
                      className="flex h-6 items-center gap-1 rounded-lg bg-white/[0.06] px-2 text-[8px] font-extrabold text-[#fbbf24]"
                    >
                      <RotateCw className="h-2.5 w-2.5" />
                      Restart
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-white/[0.06] bg-black/50 p-3 text-center text-[9px] text-zinc-500">
                  Tap POLL VPS to list remote Docker containers.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
