'use client';

import { useEffect, useState } from 'react';
import {
  Bookmark,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type AuthMode = 'none' | 'bearer' | 'basic' | 'apikey';

interface SavedApiItem {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  body: string;
  headersText: string;
}

interface ApiResponseData {
  status: number;
  statusText: string;
  elapsedMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

const STORAGE_COL = 'devdeck.api.collections.v1';
const STORAGE_ENV = 'devdeck.api.envs.v1';

const DEFAULT_ENVS: Record<string, { baseUrl: string; token: string }> = {
  Local: { baseUrl: 'http://127.0.0.1:4747', token: '' },
  Staging: { baseUrl: 'https://jsonplaceholder.typicode.com', token: '' },
  Prod: { baseUrl: 'https://api.github.com', token: '' },
};

const DEFAULT_COLLECTION: SavedApiItem[] = [
  {
    id: 'demo-get',
    name: 'Sample GET Post',
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    body: '',
    headersText: 'Accept: application/json',
  },
  {
    id: 'demo-post',
    name: 'Sample POST JSON',
    method: 'POST',
    url: 'https://jsonplaceholder.typicode.com/posts',
    body: '{\n  "title": "DevDeck API Test",\n  "body": "Hello from iPhone",\n  "userId": 1\n}',
    headersText: 'Content-Type: application/json',
  },
];

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: '#34d399',
  POST: '#fbbf24',
  PUT: '#22d3ee',
  PATCH: '#a78bfa',
  DELETE: '#ff5d6c',
};

export function ApiTesterView({ deck }: { deck: DevDeckState }) {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('https://jsonplaceholder.typicode.com/posts/1');
  const [reqTab, setReqTab] = useState<'body' | 'headers' | 'auth' | 'saved'>('body');
  const [resTab, setResTab] = useState<'body' | 'headers'>('body');
  const [headersText, setHeadersText] = useState('Accept: application/json');
  const [bodyText, setBodyText] = useState('{\n  "hello": "devdeck"\n}');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [authVal1, setAuthVal1] = useState('');
  const [authVal2, setAuthVal2] = useState('');

  const [envName, setEnvName] = useState<'Local' | 'Staging' | 'Prod'>('Staging');
  const [envs, setEnvs] = useState(DEFAULT_ENVS);
  const [collection, setCollection] = useState<SavedApiItem[]>(DEFAULT_COLLECTION);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponseData | null>(null);

  useEffect(() => {
    try {
      const c = localStorage.getItem(STORAGE_COL);
      if (c) setCollection(JSON.parse(c) as SavedApiItem[]);
      const e = localStorage.getItem(STORAGE_ENV);
      if (e) setEnvs(JSON.parse(e) as typeof DEFAULT_ENVS);
    } catch {
      // Ignore storage error
    }
  }, []);

  const saveCollection = (next: SavedApiItem[]) => {
    setCollection(next);
    try {
      localStorage.setItem(STORAGE_COL, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const updateEnvField = (field: 'baseUrl' | 'token', val: string) => {
    const next = { ...envs, [envName]: { ...envs[envName], [field]: val } };
    setEnvs(next);
    try {
      localStorage.setItem(STORAGE_ENV, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const resolveVars = (input: string) => {
    const cur = envs[envName] || { baseUrl: '', token: '' };
    return input
      .replace(/\{\{BASE_URL\}\}/g, cur.baseUrl)
      .replace(/\{\{TOKEN\}\}/g, cur.token);
  };

  const sendRequest = async () => {
    soundEngine.playClick();
    const finalUrl = resolveVars(url.trim());
    if (!finalUrl) return;
    setLoading(true);

    const headers: Record<string, string> = {};
    for (const line of headersText.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        headers[line.slice(0, idx).trim()] = resolveVars(line.slice(idx + 1).trim());
      }
    }
    if (authMode === 'bearer' && authVal1.trim()) {
      headers['Authorization'] = `Bearer ${resolveVars(authVal1.trim())}`;
    } else if (authMode === 'basic' && authVal1.trim()) {
      headers['Authorization'] = `Basic ${btoa(`${authVal1}:${authVal2}`)}`;
    } else if (authMode === 'apikey' && authVal1.trim()) {
      headers[authVal1.trim()] = resolveVars(authVal2.trim());
    }
    if (!['GET', 'DELETE'].includes(method) && bodyText.trim() && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const reqBody = ['GET'].includes(method) ? undefined : resolveVars(bodyText);

    try {
      // Prefer bridge proxy when connected (bypasses CORS and reaches localhost!)
      if (deck.status === 'connected' && deck.bridgeBaseUrl && deck.pairing?.token) {
        const res = await fetch(`${deck.bridgeBaseUrl}/api/devsuite/api-request`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${deck.pairing.token}`,
          },
          body: JSON.stringify({ method, url: finalUrl, headers, body: reqBody }),
        });
        const data = (await res.json()) as ApiResponseData;
        setResponse(data);
      } else {
        const t0 = performance.now();
        const res = await fetch(finalUrl, { method, headers, body: reqBody });
        const text = await res.text();
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          resHeaders[k] = v;
        });
        setResponse({
          status: res.status,
          statusText: res.statusText,
          elapsedMs: Math.round(performance.now() - t0),
          sizeBytes: new Blob([text]).size,
          headers: resHeaders,
          body: text,
        });
      }
    } catch (err) {
      setResponse({
        status: 0,
        statusText: 'ERROR',
        elapsedMs: 0,
        sizeBytes: 0,
        headers: {},
        body: '',
        error: err instanceof Error ? err.message : 'Request failed (CORS or offline)',
      });
    } finally {
      setLoading(false);
    }
  };

  const prettyBody = (() => {
    if (!response?.body) return '';
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  })();

  const statusColor = !response
    ? '#9ca3af'
    : response.status >= 200 && response.status < 300
      ? '#34d399'
      : response.status >= 400 || response.status === 0
        ? '#ff5d6c'
        : '#fbbf24';

  return (
    <div className="screen-grid layout-api">
      {/* LEFT: Request Builder + Collections + Environments */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#22d3ee] to-[#fbbf24]" />

        {/* Method + URL + Send */}
        <div className="flex items-center gap-1.5">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
            aria-label="HTTP Method"
            className="font-mono-tech h-8 rounded-lg border border-white/10 bg-[#080a10] px-2 text-[10px] font-extrabold outline-none"
            style={{ color: METHOD_COLOR[method] }}
          >
            {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendRequest();
            }}
            spellCheck={false}
            placeholder="https://api.example.com or {{BASE_URL}}/health"
            className="font-mono-tech h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a10] px-2.5 text-[10px] text-white outline-none focus:border-[#22d3ee]"
          />

          <button
            type="button"
            disabled={loading}
            onClick={() => void sendRequest()}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[#22d3ee] px-3 text-[9.5px] font-extrabold text-[#041318] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            SEND
          </button>
        </div>

        {/* Sub-tabs + Environment Picker */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex gap-1 rounded-full bg-black/70 p-0.5">
            {(
              [
                ['body', 'JSON Body'],
                ['headers', 'Headers'],
                ['auth', 'Auth'],
                ['saved', `Saved (${collection.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setReqTab(id);
                }}
                className="rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase"
                style={{
                  background: reqTab === id ? '#1f222c' : 'transparent',
                  color: reqTab === id ? '#22d3ee' : '#7c8190',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={envName}
            onChange={(e) => setEnvName(e.target.value as 'Local' | 'Staging' | 'Prod')}
            aria-label="Environment"
            className="font-mono-tech rounded-full border border-white/10 bg-black/70 px-2 py-0.5 text-[8.5px] font-bold text-[#fbbf24] outline-none"
          >
            <option value="Local">Env: Local</option>
            <option value="Staging">Env: Staging</option>
            <option value="Prod">Env: Prod</option>
          </select>
        </div>

        {/* Request Tab Body */}
        {reqTab === 'body' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <div className="flex items-center justify-between text-[8px] text-zinc-400">
              <span>Use {'{{BASE_URL}}'} or {'{{TOKEN}}'} variables</span>
              <button
                type="button"
                onClick={() => {
                  try {
                    setBodyText(JSON.stringify(JSON.parse(bodyText), null, 2));
                    deck.showToast(true, 'JSON formatted');
                  } catch {
                    deck.showToast(false, 'Invalid JSON body');
                  }
                }}
                className="font-bold text-[#34d399]"
              >
                Format JSON
              </button>
            </div>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              spellCheck={false}
              className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2 text-[10px] text-zinc-100 outline-none"
            />
          </div>
        )}

        {reqTab === 'headers' && (
          <textarea
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            spellCheck={false}
            placeholder="Header-Name: value (one per line)"
            className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] text-zinc-100 outline-none"
          />
        )}

        {reqTab === 'auth' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-2 overflow-auto rounded-xl border border-white/[0.07] bg-black/55 p-2.5">
            <div className="flex gap-1">
              {(['none', 'bearer', 'basic', 'apikey'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAuthMode(m)}
                  className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[8.5px] font-extrabold uppercase"
                  style={{
                    background: authMode === m ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.04)',
                    borderColor: authMode === m ? '#fbbf24' : 'rgba(255,255,255,0.08)',
                    color: authMode === m ? '#fbbf24' : '#9ca3af',
                  }}
                >
                  <KeyRound className="h-2.5 w-2.5" />
                  {m}
                </button>
              ))}
            </div>

            {authMode !== 'none' && (
              <div className="space-y-1.5">
                <input
                  value={authVal1}
                  onChange={(e) => setAuthVal1(e.target.value)}
                  placeholder={
                    authMode === 'bearer'
                      ? 'Bearer token or {{TOKEN}}'
                      : authMode === 'basic'
                        ? 'Username'
                        : 'Header name (e.g. X-API-Key)'
                  }
                  className="font-mono-tech w-full rounded-lg border border-white/10 bg-[#07080d] px-2.5 py-1.5 text-[10px] text-white outline-none"
                />
                {authMode !== 'bearer' && (
                  <input
                    value={authVal2}
                    onChange={(e) => setAuthVal2(e.target.value)}
                    placeholder={authMode === 'basic' ? 'Password' : 'API Key value'}
                    className="font-mono-tech w-full rounded-lg border border-white/10 bg-[#07080d] px-2.5 py-1.5 text-[10px] text-white outline-none"
                  />
                )}
              </div>
            )}

            <div className="space-y-1 border-t border-white/10 pt-2">
              <div className="text-[8.5px] font-extrabold text-zinc-400 uppercase">
                Environment Variables ({envName})
              </div>
              <input
                value={envs[envName]?.baseUrl || ''}
                onChange={(e) => updateEnvField('baseUrl', e.target.value)}
                placeholder="{{BASE_URL}}"
                className="font-mono-tech w-full rounded-lg border border-white/10 bg-[#07080d] px-2 py-1 text-[9.5px] text-[#22d3ee] outline-none"
              />
              <input
                value={envs[envName]?.token || ''}
                onChange={(e) => updateEnvField('token', e.target.value)}
                placeholder="{{TOKEN}}"
                className="font-mono-tech w-full rounded-lg border border-white/10 bg-[#07080d] px-2 py-1 text-[9.5px] text-[#fbbf24] outline-none"
              />
            </div>
          </div>
        )}

        {reqTab === 'saved' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => {
                const item: SavedApiItem = {
                  id: String(Date.now()),
                  name: `${method} ${url.replace(/^https?:\/\//, '').slice(0, 26)}`,
                  method,
                  url,
                  body: bodyText,
                  headersText,
                };
                saveCollection([item, ...collection]);
                deck.showToast(true, 'Saved to API collection');
              }}
              className="flex h-7 items-center justify-center gap-1 rounded-lg border border-[#34d399]/35 bg-[#34d399]/15 text-[9px] font-extrabold text-[#34d399]"
            >
              <Plus className="h-3 w-3" />
              Save Current Request
            </button>
            <div className="deck-scroll min-h-0 flex-1 space-y-1 overflow-auto">
              {collection.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-black/60 px-2 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setMethod(item.method);
                      setUrl(item.url);
                      setBodyText(item.body);
                      setHeadersText(item.headersText);
                      setReqTab('body');
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="font-mono-tech shrink-0 text-[8.5px] font-extrabold"
                      style={{ color: METHOD_COLOR[item.method] }}
                    >
                      {item.method}
                    </span>
                    <span className="truncate text-[9.5px] font-bold text-zinc-200">{item.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete saved request"
                    onClick={() => saveCollection(collection.filter((c) => c.id !== item.id))}
                    className="text-zinc-500 hover:text-[#ff5d6c]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Response Viewer */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-full bg-black/70 p-0.5">
            {(['body', 'headers'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setResTab(t)}
                className="rounded-full px-2.5 py-0.5 text-[8.5px] font-extrabold uppercase"
                style={{
                  background: resTab === t ? '#1f222c' : 'transparent',
                  color: resTab === t ? '#34d399' : '#7c8190',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {response && (
              <>
                <span
                  className="font-mono-tech rounded-full px-2 py-0.5 text-[8.5px] font-extrabold"
                  style={{ background: `${statusColor}22`, color: statusColor }}
                >
                  {response.status || 'ERR'} {response.statusText}
                </span>
                <span className="font-mono-tech text-[8.5px] text-zinc-400">
                  {response.elapsedMs}ms · {(response.sizeBytes / 1024).toFixed(1)}KB
                </span>
                <button
                  type="button"
                  aria-label="Copy response"
                  onClick={() => {
                    void navigator.clipboard?.writeText(prettyBody);
                    deck.showToast(true, 'Response copied');
                  }}
                  className="rounded bg-white/[0.06] p-1 text-zinc-300"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        </div>

        {!response ? (
          <div className="grid min-h-0 flex-1 place-items-center rounded-xl border border-white/[0.06] bg-[#06070b] text-center">
            <div className="space-y-1">
              <Bookmark className="mx-auto h-5 w-5 text-zinc-600" />
              <div className="text-[10px] font-bold text-zinc-400">
                Tap SEND to test any REST API
              </div>
              <div className="text-[8.5px] text-zinc-500">
                {deck.status === 'connected'
                  ? 'Bridge Proxy Active (Zero CORS · Localhost supported)'
                  : 'Phone Direct Mode (Public CORS APIs)'}
              </div>
            </div>
          </div>
        ) : resTab === 'body' ? (
          <pre className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-[9.5px] leading-relaxed text-[#d4f5e9]">
            {response.error ? `Error: ${response.error}` : prettyBody || '(Empty body)'}
          </pre>
        ) : (
          <div className="deck-scroll font-mono-tech min-h-0 flex-1 space-y-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-[9px]">
            {Object.entries(response.headers).map(([k, v]) => (
              <div key={k} className="flex gap-2 border-b border-white/[0.05] pb-1">
                <span className="shrink-0 font-bold text-[#22d3ee]">{k}:</span>
                <span className="break-all text-zinc-300">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
