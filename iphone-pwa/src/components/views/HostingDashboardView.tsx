'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Container,
  Database,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCw,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

interface SavedProject {
  id: string;
  name: string;
  url: string;
  env: string;
}

interface HostingData {
  databases: Array<{ name: string; port: number; status: 'online' | 'offline' }>;
  repos: Array<{ name: string; url: string; branch: string; isPrivate: boolean; updatedAt: string }>;
  deployments: Array<{ id: string; title: string; target: string; status: string; time: string }>;
  checkedAt: number;
}

const STORAGE_PROJECTS = 'devdeck.hosting.projects.v1';

const DEFAULT_PROJECTS: SavedProject[] = [
  { id: 'helper', name: 'DevDeck (HELPER)', url: 'https://helper-nu-swart.vercel.app', env: 'Vercel Hobby' },
];

export function HostingDashboardView({ deck }: { deck: DevDeckState }) {
  const [projects, setProjects] = useState<SavedProject[]>(DEFAULT_PROJECTS);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [tab, setTab] = useState<'deploys' | 'dbs' | 'repos' | 'docker' | 'logs'>('deploys');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HostingData | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PROJECTS);
      if (saved) setProjects(JSON.parse(saved) as SavedProject[]);
    } catch {
      // Ignore
    }
  }, []);

  const persistProjects = (next: SavedProject[]) => {
    setProjects(next);
    try {
      localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const refreshHosting = useCallback(async () => {
    if (deck.status !== 'connected' || !deck.bridgeBaseUrl || !deck.pairing?.token) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/hosting`, {
        headers: { authorization: `Bearer ${deck.pairing.token}` },
      });
      if (res.ok) {
        setData((await res.json()) as HostingData);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [deck.bridgeBaseUrl, deck.pairing?.token, deck.status]);

  useEffect(() => {
    void refreshHosting();
  }, [refreshHosting]);

  const addProject = () => {
    if (!newName.trim()) return;
    soundEngine.playClick();
    const url = newUrl.trim()
      ? /^https?:\/\//i.test(newUrl.trim())
        ? newUrl.trim()
        : `https://${newUrl.trim()}`
      : '';
    persistProjects([
      { id: String(Date.now()), name: newName.trim(), url, env: 'Production' },
      ...projects,
    ]);
    setNewName('');
    setNewUrl('');
  };

  const dockerAction = (id: string, action: 'start' | 'stop' | 'restart') => {
    soundEngine.playClick();
    deck.sendEvent({ type: 'docker:action', payload: { requestId: makeRequestId(), id, action } });
  };

  return (
    <div className="screen-grid layout-hosting">
      {/* LEFT: Multi-Project Manager + Quick Deploy */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#fbbf24] to-[#34d399]" />

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <FolderKanban className="h-4 w-4 text-[#fbbf24]" />
            <span className="disp text-[17px]">Hosting Hub</span>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              soundEngine.playClick();
              void refreshHosting();
              deck.sendEvent({ type: 'docker:refresh', payload: { requestId: makeRequestId() } });
            }}
            className="flex h-7 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 text-[8.5px] font-extrabold text-zinc-200"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            SYNC
          </button>
        </div>

        {/* Add Project Row */}
        <div className="grid grid-cols-12 gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            className="col-span-5 h-7 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9px] text-white outline-none"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://app.com"
            className="font-mono-tech col-span-5 h-7 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[9px] text-white outline-none"
          />
          <button
            type="button"
            onClick={addProject}
            aria-label="Add project"
            className="col-span-2 grid h-7 place-items-center rounded-lg bg-[#fbbf24] text-[#1a1204]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Projects List */}
        <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto pr-0.5">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/60 px-2.5 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[10px] font-extrabold text-white">{p.name}</span>
                  <span className="rounded bg-[#34d399]/20 px-1.5 py-0.5 text-[7.5px] font-extrabold text-[#34d399]">
                    {p.env}
                  </span>
                </div>
                {p.url && (
                  <div className="font-mono-tech truncate text-[8px] text-zinc-400">{p.url}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${p.name}`}
                    className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.06] text-[#22d3ee]"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <button
                  type="button"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => persistProjects(projects.filter((x) => x.id !== p.id))}
                  className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.05] text-zinc-500 hover:text-[#ff5d6c]"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 1-Tap Git Push / Deploy */}
        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            deck.sendEvent({
              type: 'git:deploy',
              payload: { requestId: makeRequestId(), action: 'push' },
            });
          }}
          className="flex h-8 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#fbbf24] to-[#34d399] text-[9.5px] font-extrabold text-[#0b130c]"
        >
          <Rocket className="h-3.5 w-3.5" />
          PUSH &amp; TRIGGER DEPLOY ({deck.gitStatus.branch || 'main'})
        </button>
      </div>

      {/* RIGHT: Deployments | Databases | GitHub Repos | Docker | Server Logs */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />

        <div className="flex gap-1 overflow-x-auto rounded-full bg-black/70 p-0.5">
          {(
            [
              ['deploys', 'Deploys', Rocket, '#34d399'],
              ['dbs', 'Databases', Database, '#22d3ee'],
              ['repos', 'GitHub', GitBranch, '#a78bfa'],
              ['docker', `Docker (${deck.docker.containers.length})`, Container, '#fbbf24'],
              ['logs', 'Logs', Terminal, '#f472b6'],
            ] as const
          ).map(([id, label, Icon, color]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setTab(id);
              }}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
              style={{
                background: tab === id ? '#1f222c' : 'transparent',
                color: tab === id ? color : '#7c8190',
              }}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'deploys' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto pr-0.5">
            {data?.deployments?.length ? (
              data.deployments.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/60 px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[9.5px] font-bold text-white">{d.title}</div>
                    <div className="font-mono-tech text-[8px] text-zinc-400">
                      {d.id} · {d.target} · {d.time}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#34d399]/20 px-2 py-0.5 text-[7.5px] font-extrabold text-[#34d399]">
                    {d.status}
                  </span>
                </div>
              ))
            ) : (
              <div className="grid h-full place-items-center text-[10px] text-zinc-500">
                Pair computer bridge and tap SYNC to load live deployments.
              </div>
            )}
          </div>
        )}

        {tab === 'dbs' && (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
            {(
              data?.databases || [
                { name: 'PostgreSQL', port: 5432, status: 'offline' as const },
                { name: 'MySQL / MariaDB', port: 3306, status: 'offline' as const },
                { name: 'Redis', port: 6379, status: 'offline' as const },
                { name: 'MongoDB', port: 27017, status: 'offline' as const },
              ]
            ).map((db) => {
              const up = db.status === 'online';
              return (
                <div
                  key={db.name}
                  className="flex flex-col justify-between rounded-xl border bg-black/65 p-2.5"
                  style={{ borderColor: up ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.07)' }}
                >
                  <div className="flex items-center justify-between">
                    <Database className="h-4 w-4" style={{ color: up ? '#34d399' : '#71717a' }} />
                    <span
                      className="rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase"
                      style={{
                        background: up ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)',
                        color: up ? '#34d399' : '#71717a',
                      }}
                    >
                      {db.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-extrabold text-white">{db.name}</div>
                    <div className="font-mono-tech text-[8.5px] text-zinc-400">
                      127.0.0.1:{db.port}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'repos' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto pr-0.5">
            {data?.repos?.length ? (
              data.repos.map((r) => (
                <a
                  key={r.name}
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/60 px-2.5 py-1.5 hover:border-[#a78bfa]/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-extrabold text-white">{r.name}</div>
                    <div className="font-mono-tech text-[8px] text-zinc-400">
                      {r.branch} · {r.isPrivate ? 'Private' : 'Public'} · {r.updatedAt}
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#a78bfa]" />
                </a>
              ))
            ) : (
              <div className="grid h-full place-items-center text-[10px] text-zinc-500">
                Pair computer bridge (with git or gh CLI) to view repositories.
              </div>
            )}
          </div>
        )}

        {tab === 'docker' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto pr-0.5">
            {deck.docker.containers.length > 0 ? (
              deck.docker.containers.map((c) => {
                const running = /up/i.test(c.status);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/60 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[9.5px] font-extrabold text-white">{c.name}</div>
                      <div className="font-mono-tech truncate text-[8px] text-zinc-400">
                        {c.status}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => dockerAction(c.id, running ? 'stop' : 'start')}
                        aria-label={running ? 'Stop container' : 'Start container'}
                        className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.06] text-[#34d399]"
                      >
                        {running ? <Square className="h-3 w-3 text-[#ff5d6c]" /> : <Play className="h-3 w-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => dockerAction(c.id, 'restart')}
                        aria-label="Restart container"
                        className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.06] text-[#fbbf24]"
                      >
                        <RotateCw className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="grid h-full place-items-center text-[10px] text-zinc-500">
                {deck.docker.available
                  ? 'No Docker containers running on host.'
                  : 'Docker Desktop not running on paired computer.'}
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-0.5 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2 text-[8.5px] text-zinc-200">
            {deck.logs.length > 0 ? (
              deck.logs.slice(-40).map((l) => (
                <div
                  key={l.id}
                  className={l.stream === 'stderr' ? 'text-[#ff5d6c]' : 'text-[#d4f5e9]'}
                >
                  {l.text}
                </div>
              ))
            ) : (
              <div className="grid h-full place-items-center text-zinc-500">
                No server logs streamed yet — start a stream in Live Monitor.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
