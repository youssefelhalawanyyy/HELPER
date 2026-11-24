'use client';

import { useMemo, useState } from 'react';
import {
  Binary,
  Braces,
  Code2,
  Copy,
  Database,
  FileText,
  KeyRound,
  Play,
  Regex,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { soundEngine } from '@/lib/soundEngine';

type ToolId = 'json' | 'base64' | 'jwt' | 'regex' | 'web' | 'sql' | 'markdown';

function formatSql(input: string): string {
  const keywords = [
    'SELECT',
    'FROM',
    'WHERE',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'JOIN',
    'ON',
    'GROUP BY',
    'ORDER BY',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'INSERT INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE FROM',
    'AND',
    'OR',
    'AS',
    'DESC',
    'ASC',
  ];
  let out = input.replace(/\s+/g, ' ').trim();
  for (const kw of keywords) {
    out = out.replace(new RegExp(`\\b${kw}\\b`, 'gi'), kw);
  }
  const newlines = [
    'SELECT',
    'FROM',
    'WHERE',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'JOIN',
    'GROUP BY',
    'ORDER BY',
    'HAVING',
    'LIMIT',
    'VALUES',
    'SET',
  ];
  for (const kw of newlines) {
    out = out.replace(new RegExp(`\\s+(${kw})\\b`, 'g'), `\n$1`);
  }
  out = out.replace(/\s+(AND|OR)\b/g, '\n  $1');
  return out;
}

function decodeBase64Utf8(str: string): string {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function renderSimpleMarkdown(md: string): string {
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/```([\s\S]*?)```/g, '<pre style="background:#07090d;padding:8px;border-radius:8px;overflow:auto;font-size:11px;color:#34d399">$1</pre>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:800;color:#22d3ee;margin:6px 0 2px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:800;color:#c4b5fd;margin:8px 0 3px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:17px;font-weight:800;color:#fff;margin:8px 0 4px">$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:2px solid #a78bfa;padding-left:8px;color:#a1a1aa;margin:4px 0">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:10px">• $1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:4px;color:#fbbf24">$1</code>')
    .replace(/\n/g, '<br/>');
}

export function CodePlaygroundView({ deck }: { deck: DevDeckState }) {
  const [tool, setTool] = useState<ToolId>('json');

  // JSON
  const [jsonInput, setJsonInput] = useState('{"app":"DevDeck","version":2,"features":["api","ssh","monitor"]}');
  // Base64
  const [b64Input, setB64Input] = useState('Hello DevDeck Pro!');
  const [b64Mode, setB64Mode] = useState<'encode' | 'decode'>('encode');
  // JWT
  const [jwtInput, setJwtInput] = useState(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXZkZWNrIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjIwMDAwMDAwMDB9.signature',
  );
  // Regex
  const [regexPattern, setRegexPattern] = useState('([a-z0-9._%+-]+)@([a-z0-9.-]+\\.[a-z]{2,})');
  const [regexFlags, setRegexFlags] = useState('gi');
  const [regexSample, setRegexSample] = useState('Contact dev@devdeck.io or admin@helper.dev for alerts.');
  // HTML/CSS/JS
  const [htmlCode, setHtmlCode] = useState('<div class="card"><h2>DevDeck Lab</h2><button id="b">Click: 0</button></div>');
  const [cssCode, setCssCode] = useState('body{background:#0b0c12;color:#f4f4f8;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}.card{background:#181a24;border:1px solid #2e3244;padding:16px 22px;border-radius:14px;text-align:center}button{background:#22d3ee;border:0;padding:6px 14px;border-radius:8px;font-weight:800;cursor:pointer}');
  const [jsCode, setJsCode] = useState('let n=0;document.getElementById("b").onclick=e=>e.target.textContent="Click: "+(++n);');
  const [webTab, setWebTab] = useState<'html' | 'css' | 'js'>('html');
  // SQL
  const [sqlInput, setSqlInput] = useState(
    'select u.id, u.email, count(o.id) as orders from users u left join orders o on o.user_id = u.id where u.active = true and o.total > 50 group by u.id, u.email order by orders desc limit 20;',
  );
  // Markdown
  const [mdInput, setMdInput] = useState(
    '# DevDeck Release Notes\n\n> Live **Markdown** preview with `inline code`.\n\n## Included Tools\n- JSON & SQL Formatter\n- Base64 & JWT Decoder\n- Regex & HTML/CSS/JS Lab\n\n```ts\nconsole.log("Ready!");\n```',
  );

  const jsonResult = useMemo(() => {
    try {
      const parsed = JSON.parse(jsonInput);
      return { ok: true, pretty: JSON.stringify(parsed, null, 2), minified: JSON.stringify(parsed), error: '' };
    } catch (e) {
      return { ok: false, pretty: '', minified: '', error: e instanceof Error ? e.message : 'Invalid JSON' };
    }
  }, [jsonInput]);

  const b64Result = useMemo(() => {
    try {
      return {
        ok: true,
        output: b64Mode === 'encode' ? encodeBase64Utf8(b64Input) : decodeBase64Utf8(b64Input),
        error: '',
      };
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : 'Conversion failed' };
    }
  }, [b64Input, b64Mode]);

  const jwtResult = useMemo(() => {
    const parts = jwtInput.trim().split('.');
    if (parts.length < 2) return { ok: false, header: '', payload: '', expired: null as boolean | null, expText: '' };
    try {
      const h = JSON.parse(decodeBase64Utf8(parts[0]));
      const p = JSON.parse(decodeBase64Utf8(parts[1])) as { exp?: number };
      let expired: boolean | null = null;
      let expText = '';
      if (typeof p.exp === 'number') {
        expired = p.exp * 1000 < Date.now();
        expText = new Date(p.exp * 1000).toLocaleString();
      }
      return {
        ok: true,
        header: JSON.stringify(h, null, 2),
        payload: JSON.stringify(p, null, 2),
        expired,
        expText,
      };
    } catch {
      return { ok: false, header: '', payload: '', expired: null, expText: '' };
    }
  }, [jwtInput]);

  const regexResult = useMemo(() => {
    if (!regexPattern) return { ok: true, matches: [] as Array<{ full: string; groups: string[] }>, error: '' };
    try {
      const safeFlags = regexFlags.includes('g') ? regexFlags : `${regexFlags}g`;
      const re = new RegExp(regexPattern, safeFlags);
      const matches: Array<{ full: string; groups: string[] }> = [];
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(regexSample)) !== null && guard < 100) {
        guard += 1;
        matches.push({ full: m[0], groups: m.slice(1) });
        if (m[0].length === 0) re.lastIndex += 1;
      }
      return { ok: true, matches, error: '' };
    } catch (e) {
      return { ok: false, matches: [], error: e instanceof Error ? e.message : 'Invalid regex' };
    }
  }, [regexPattern, regexFlags, regexSample]);

  const sqlFormatted = useMemo(() => formatSql(sqlInput), [sqlInput]);
  const webSrcDoc = useMemo(
    () => `<!doctype html><html><head><style>${cssCode}</style></head><body>${htmlCode}<script>${jsCode}<\/script></body></html>`,
    [htmlCode, cssCode, jsCode],
  );

  const copyOut = (text: string, label: string) => {
    soundEngine.playClick();
    void navigator.clipboard?.writeText(text);
    deck.showToast(true, `${label} copied`);
  };

  const tools: Array<{ id: ToolId; label: string; Icon: typeof Code2 }> = [
    { id: 'json', label: 'JSON', Icon: Braces },
    { id: 'base64', label: 'Base64', Icon: Binary },
    { id: 'jwt', label: 'JWT', Icon: KeyRound },
    { id: 'regex', label: 'Regex', Icon: Regex },
    { id: 'web', label: 'HTML/JS', Icon: Play },
    { id: 'sql', label: 'SQL', Icon: Database },
    { id: 'markdown', label: 'Markdown', Icon: FileText },
  ];

  return (
    <div className="screen-grid layout-playground">
      {/* LEFT: Tool Switcher + Input Editor */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#a78bfa] to-[#22d3ee]" />

        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {tools.map(({ id, label, Icon }) => {
            const active = tool === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  setTool(id);
                }}
                className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[8.5px] font-extrabold uppercase"
                style={{
                  background: active ? 'rgba(167,139,250,0.22)' : 'rgba(255,255,255,0.04)',
                  borderColor: active ? '#a78bfa' : 'rgba(255,255,255,0.08)',
                  color: active ? '#e9d5ff' : '#9ca3af',
                }}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
        </div>

        {tool === 'json' && (
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            spellCheck={false}
            className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] text-zinc-100 outline-none focus:border-[#a78bfa]"
            placeholder="Paste JSON here…"
          />
        )}

        {tool === 'base64' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex gap-1">
              {(['encode', 'decode'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setB64Mode(m);
                  }}
                  className="rounded-lg border px-2.5 py-1 text-[8.5px] font-extrabold uppercase"
                  style={{
                    background: b64Mode === m ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.04)',
                    borderColor: b64Mode === m ? '#22d3ee' : 'rgba(255,255,255,0.08)',
                    color: b64Mode === m ? '#22d3ee' : '#9ca3af',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
            <textarea
              value={b64Input}
              onChange={(e) => setB64Input(e.target.value)}
              spellCheck={false}
              className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] text-zinc-100 outline-none"
            />
          </div>
        )}

        {tool === 'jwt' && (
          <textarea
            value={jwtInput}
            onChange={(e) => setJwtInput(e.target.value)}
            spellCheck={false}
            className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] break-all text-[#fbbf24] outline-none"
            placeholder="Paste JWT token (header.payload.signature)…"
          />
        )}

        {tool === 'regex' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex gap-1.5">
              <input
                value={regexPattern}
                onChange={(e) => setRegexPattern(e.target.value)}
                spellCheck={false}
                placeholder="Regex pattern"
                className="font-mono-tech min-w-0 flex-1 rounded-lg border border-white/10 bg-[#07080d] px-2 py-1 text-[10px] text-[#22d3ee] outline-none"
              />
              <input
                value={regexFlags}
                onChange={(e) => setRegexFlags(e.target.value)}
                spellCheck={false}
                placeholder="gi"
                className="font-mono-tech w-14 rounded-lg border border-white/10 bg-[#07080d] px-2 py-1 text-center text-[10px] text-[#fbbf24] outline-none"
              />
            </div>
            <textarea
              value={regexSample}
              onChange={(e) => setRegexSample(e.target.value)}
              spellCheck={false}
              className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] text-zinc-100 outline-none"
              placeholder="Test text…"
            />
          </div>
        )}

        {tool === 'web' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex gap-1">
              {(['html', 'css', 'js'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setWebTab(t)}
                  className="rounded-lg border px-2.5 py-0.5 text-[8.5px] font-extrabold uppercase"
                  style={{
                    background: webTab === t ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.04)',
                    borderColor: webTab === t ? '#34d399' : 'rgba(255,255,255,0.08)',
                    color: webTab === t ? '#34d399' : '#9ca3af',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              value={webTab === 'html' ? htmlCode : webTab === 'css' ? cssCode : jsCode}
              onChange={(e) => {
                if (webTab === 'html') setHtmlCode(e.target.value);
                else if (webTab === 'css') setCssCode(e.target.value);
                else setJsCode(e.target.value);
              }}
              spellCheck={false}
              className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] text-zinc-100 outline-none"
            />
          </div>
        )}

        {tool === 'sql' && (
          <textarea
            value={sqlInput}
            onChange={(e) => setSqlInput(e.target.value)}
            spellCheck={false}
            className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] text-zinc-100 outline-none"
            placeholder="Paste SQL query…"
          />
        )}

        {tool === 'markdown' && (
          <textarea
            value={mdInput}
            onChange={(e) => setMdInput(e.target.value)}
            spellCheck={false}
            className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-[#07080d] p-2.5 text-[10px] text-zinc-100 outline-none"
            placeholder="Write Markdown…"
          />
        )}
      </div>

      {/* RIGHT: Live Output / Preview */}
      <div className="tile flex min-h-0 flex-col gap-2">
        <div className="absolute top-0 left-0 h-[3px] w-1/2 rounded-r-full bg-[#34d399]" />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Code2 className="h-3.5 w-3.5 text-[#34d399]" />
            <span className="text-[10px] font-extrabold tracking-wider text-zinc-200 uppercase">
              {tool === 'web' ? 'Live Sandbox Preview' : tool === 'markdown' ? 'Markdown Preview' : 'Output'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {tool === 'json' && (
              <>
                <span
                  className="rounded-full px-2 py-0.5 text-[8px] font-extrabold"
                  style={{
                    background: jsonResult.ok ? 'rgba(52,211,153,0.18)' : 'rgba(255,93,108,0.18)',
                    color: jsonResult.ok ? '#34d399' : '#ff5d6c',
                  }}
                >
                  {jsonResult.ok ? 'VALID JSON' : 'INVALID'}
                </span>
                {jsonResult.ok && (
                  <>
                    <button
                      type="button"
                      onClick={() => copyOut(jsonResult.minified, 'Minified JSON')}
                      className="rounded-lg bg-white/[0.06] px-2 py-0.5 text-[8px] font-extrabold text-zinc-300"
                    >
                      Minify
                    </button>
                    <button
                      type="button"
                      onClick={() => copyOut(jsonResult.pretty, 'Formatted JSON')}
                      className="flex items-center gap-1 rounded-lg bg-[#34d399]/20 px-2 py-0.5 text-[8px] font-extrabold text-[#34d399]"
                    >
                      <Copy className="h-2.5 w-2.5" />
                      Copy
                    </button>
                  </>
                )}
              </>
            )}
            {tool === 'base64' && b64Result.ok && (
              <button
                type="button"
                onClick={() => copyOut(b64Result.output, 'Base64')}
                className="flex items-center gap-1 rounded-lg bg-[#22d3ee]/20 px-2 py-0.5 text-[8px] font-extrabold text-[#22d3ee]"
              >
                <Copy className="h-2.5 w-2.5" />
                Copy
              </button>
            )}
            {tool === 'sql' && (
              <button
                type="button"
                onClick={() => copyOut(sqlFormatted, 'SQL')}
                className="flex items-center gap-1 rounded-lg bg-[#34d399]/20 px-2 py-0.5 text-[8px] font-extrabold text-[#34d399]"
              >
                <Copy className="h-2.5 w-2.5" />
                Copy SQL
              </button>
            )}
            {tool === 'jwt' && jwtResult.ok && jwtResult.expired !== null && (
              <span
                className="rounded-full px-2 py-0.5 text-[8px] font-extrabold"
                style={{
                  background: jwtResult.expired ? 'rgba(255,93,108,0.2)' : 'rgba(52,211,153,0.2)',
                  color: jwtResult.expired ? '#ff5d6c' : '#34d399',
                }}
              >
                {jwtResult.expired ? 'EXPIRED' : 'VALID'} · {jwtResult.expText}
              </span>
            )}
            {tool === 'regex' && (
              <span className="rounded-full bg-[#22d3ee]/20 px-2 py-0.5 text-[8px] font-extrabold text-[#22d3ee]">
                {regexResult.matches.length} MATCH(ES)
              </span>
            )}
          </div>
        </div>

        {tool === 'json' && (
          <pre className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-[10px] leading-relaxed text-[#34d399]">
            {jsonResult.ok ? jsonResult.pretty : `Error: ${jsonResult.error}`}
          </pre>
        )}

        {tool === 'base64' && (
          <pre className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-[10px] break-all whitespace-pre-wrap text-[#22d3ee]">
            {b64Result.ok ? b64Result.output : `Error: ${b64Result.error}`}
          </pre>
        )}

        {tool === 'jwt' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto">
            {jwtResult.ok ? (
              <>
                <div className="rounded-xl border border-white/[0.07] bg-[#06070b] p-2">
                  <div className="mb-0.5 text-[8px] font-extrabold text-[#fbbf24] uppercase">Header</div>
                  <pre className="font-mono-tech text-[9.5px] text-zinc-200">{jwtResult.header}</pre>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-[#06070b] p-2">
                  <div className="mb-0.5 text-[8px] font-extrabold text-[#a78bfa] uppercase">Payload</div>
                  <pre className="font-mono-tech text-[9.5px] text-[#34d399]">{jwtResult.payload}</pre>
                </div>
              </>
            ) : (
              <div className="grid h-full place-items-center text-[10px] text-[#ff5d6c]">
                Paste a valid 3-part JWT to decode Header &amp; Payload
              </div>
            )}
          </div>
        )}

        {tool === 'regex' && (
          <div className="deck-scroll min-h-0 flex-1 space-y-1.5 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5">
            {!regexResult.ok ? (
              <div className="font-mono-tech text-[10px] text-[#ff5d6c]">{regexResult.error}</div>
            ) : regexResult.matches.length === 0 ? (
              <div className="text-[10px] text-zinc-500">No matches found.</div>
            ) : (
              regexResult.matches.map((m, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[9.5px]"
                >
                  <div className="font-mono-tech font-bold text-[#34d399]">
                    #{idx + 1}: {m.full}
                  </div>
                  {m.groups.length > 0 && (
                    <div className="font-mono-tech mt-0.5 text-[8.5px] text-[#22d3ee]">
                      Groups: {m.groups.map((g, gi) => `$${gi + 1}="${g}"`).join(' · ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tool === 'web' && (
          <iframe
            title="HTML CSS JS Sandbox"
            sandbox="allow-scripts"
            srcDoc={webSrcDoc}
            className="min-h-0 flex-1 rounded-xl border border-white/10 bg-[#0b0c12]"
          />
        )}

        {tool === 'sql' && (
          <pre className="deck-scroll font-mono-tech min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-2.5 text-[10px] leading-relaxed text-[#22d3ee]">
            {sqlFormatted}
          </pre>
        )}

        {tool === 'markdown' && (
          <div
            className="deck-scroll min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.07] bg-[#06070b] p-3 text-[11px] leading-relaxed text-zinc-200"
            dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(mdInput) }}
          />
        )}
      </div>
    </div>
  );
}
