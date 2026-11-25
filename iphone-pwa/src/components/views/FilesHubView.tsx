'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  Check,
  Clipboard,
  Code2,
  Copy,
  Download,
  File,
  FileCode2,
  Folder,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Send,
  Upload,
} from 'lucide-react';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

type HubTab = 'drop' | 'explorer' | 'clipboard';
type RootKey = 'project' | 'desktop' | 'downloads' | 'documents';

interface FileEntry {
  name: string;
  relPath: string;
  isDir: boolean;
  sizeBytes: number;
  mtimeMs: number;
  ext: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesHubView({ deck }: { deck: DevDeckState }) {
  const [tab, setTab] = useState<HubTab>('drop');
  const [root, setRoot] = useState<RootKey>('downloads');
  const [currentDir, setCurrentDir] = useState('');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Code Editor state
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileDirty, setFileDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // AirDrop Upload state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Image + Text Clipboard Sync state
  const [clipSearch, setClipSearch] = useState('');
  const [clipImage, setClipImage] = useState<string | null>(null);
  const [clipImgLoading, setClipImgLoading] = useState(false);
  const [clipTextInput, setClipTextInput] = useState('');
  const clipImgInputRef = useRef<HTMLInputElement | null>(null);

  const isConnected = deck.status === 'connected' && Boolean(deck.bridgeBaseUrl && deck.pairing?.token);

  const authHeaders = useMemo(
    () => ({
      'content-type': 'application/json',
      authorization: `Bearer ${deck.pairing?.token || ''}`,
    }),
    [deck.pairing?.token],
  );

  const fetchList = useCallback(
    async (targetRoot: RootKey = root, dir = currentDir, q = query) => {
      if (!isConnected || !deck.bridgeBaseUrl) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ root: targetRoot, dir, q });
        const res = await fetch(`${deck.bridgeBaseUrl}/api/files/list?${params}`, {
          headers: authHeaders,
        });
        const data = (await res.json()) as {
          ok?: boolean;
          currentDir?: string;
          entries?: FileEntry[];
        };
        if (data?.ok) {
          setEntries(data.entries || []);
          setCurrentDir(data.currentDir || '');
        }
      } catch {
        // Ignore transient network errors
      } finally {
        setLoading(false);
      }
    },
    [isConnected, deck.bridgeBaseUrl, authHeaders, root, currentDir, query],
  );

  useEffect(() => {
    if (isConnected && (tab === 'drop' || tab === 'explorer')) {
      void fetchList(root, currentDir, query);
    }
  }, [isConnected, tab, root, currentDir, fetchList, query]);

  const handleOpenFile = async (entry: FileEntry) => {
    soundEngine.playClick();
    if (entry.isDir) {
      setQuery('');
      setCurrentDir(entry.relPath);
      return;
    }
    if (!deck.bridgeBaseUrl) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ root, path: entry.relPath });
      const res = await fetch(`${deck.bridgeBaseUrl}/api/files/read?${params}`, {
        headers: authHeaders,
      });
      const data = (await res.json()) as { ok?: boolean; content?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not open file');
      setOpenFilePath(entry.relPath);
      setFileContent(data.content || '');
      setFileDirty(false);
    } catch (err) {
      deck.showToast(false, err instanceof Error ? err.message : 'Binary file — use Download');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!openFilePath || !deck.bridgeBaseUrl || savingFile) return;
    soundEngine.playClick();
    setSavingFile(true);
    try {
      const res = await fetch(`${deck.bridgeBaseUrl}/api/files/write`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ root, path: openFilePath, content: fileContent }),
      });
      const data = (await res.json()) as { ok?: boolean; bytes?: number; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed');
      setFileDirty(false);
      deck.showToast(true, `Saved ${openFilePath} (${formatBytes(data.bytes || 0)})`);
    } catch (err) {
      deck.showToast(false, err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingFile(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !deck.bridgeBaseUrl || !isConnected) return;
    setUploading(true);
    let sent = 0;
    try {
      for (const file of Array.from(files)) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });
        const res = await fetch(`${deck.bridgeBaseUrl}/api/files/upload`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            root,
            dir: currentDir,
            filename: file.name,
            data: base64,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error || `Failed to send ${file.name}`);
        sent += 1;
      }
      deck.showToast(true, `Sent ${sent} file${sent === 1 ? '' : 's'} to ~/${root}!`);
      void fetchList(root, currentDir, '');
    } catch (err) {
      deck.showToast(false, err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePullClipboardImage = async () => {
    if (!deck.bridgeBaseUrl || !isConnected) return;
    soundEngine.playClick();
    setClipImgLoading(true);
    try {
      const res = await fetch(`${deck.bridgeBaseUrl}/api/clipboard/image`, { headers: authHeaders });
      const data = (await res.json()) as { ok?: boolean; hasImage?: boolean; dataUrl?: string | null };
      if (data.hasImage && data.dataUrl) {
        setClipImage(data.dataUrl);
        deck.showToast(true, 'Pulled screenshot/image from computer clipboard');
      } else {
        setClipImage(null);
        deck.showToast(false, 'No image currently on computer clipboard');
      }
    } finally {
      setClipImgLoading(false);
    }
  };

  const handlePushClipboardImage = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !deck.bridgeBaseUrl || !isConnected) return;
    setClipImgLoading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Read failed'));
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${deck.bridgeBaseUrl}/api/clipboard/image`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ dataUrl }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (data.ok) {
        setClipImage(dataUrl);
        deck.showToast(true, 'Image copied to computer clipboard (ready to Cmd/Ctrl+V!)');
      } else {
        deck.showToast(false, data.message || 'Could not push image');
      }
    } finally {
      setClipImgLoading(false);
      if (clipImgInputRef.current) clipImgInputRef.current.value = '';
    }
  };

  const downloadUrl = (relPath: string) =>
    `${deck.bridgeBaseUrl}/api/files/download?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}&token=${encodeURIComponent(deck.pairing?.token || '')}`;

  const filteredClipboard = useMemo(() => {
    const q = clipSearch.trim().toLowerCase();
    if (!q) return deck.clipboard.history;
    return deck.clipboard.history.filter((c) => c.text.toLowerCase().includes(q));
  }, [deck.clipboard.history, clipSearch]);

  const goParentDir = () => {
    if (!currentDir) return;
    const parts = currentDir.split('/').filter(Boolean);
    parts.pop();
    setCurrentDir(parts.join('/'));
  };

  return (
    <div className="tile flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="absolute top-0 left-0 h-[3px] w-2/3 rounded-r-full bg-gradient-to-r from-[#88f1d1] via-[#7dd3fc] to-[#a78bfa]" />

      {/* Top Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-black/75 p-0.5">
          {(
            [
              ['drop', 'AirDrop Transfer', Upload, '#88f1d1'],
              ['explorer', 'Code & Files', FileCode2, '#7dd3fc'],
              ['clipboard', 'Clipboard + Images', Clipboard, '#fbbf24'],
            ] as const
          ).map(([id, label, Icon, col]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setTab(id);
                if (id === 'explorer') {
                  setRoot('project');
                  setCurrentDir('');
                } else if (id === 'drop') {
                  setRoot('downloads');
                  setCurrentDir('');
                }
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
              style={{
                background: tab === id ? '#172b34' : 'transparent',
                color: tab === id ? col : '#7c8190',
              }}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            if (tab === 'clipboard') void handlePullClipboardImage();
            else void fetchList();
          }}
          className="flex h-7 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2.5 text-[10px] font-bold text-[#9cb4bb] hover:text-white"
        >
          <RefreshCw className={`h-3 w-3 ${loading || clipImgLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* TAB 1: 2-WAY AIRDROP FILE & PHOTO DROP */}
      {tab === 'drop' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 md:grid-cols-12">
          <div className="flex flex-col justify-between gap-2 rounded-2xl border border-[#88f1d1]/35 bg-[#08151b] p-3 md:col-span-5">
            <div>
              <div className="disp text-[18px] text-[#88f1d1]">iPhone → Computer Drop</div>
              <p className="mt-0.5 text-[10.5px] text-[#9cb4bb]">
                Send photos, videos, PDFs, or any file straight into{' '}
                <code className="text-[#88f1d1]">
                  {root === 'downloads'
                    ? '~/Downloads'
                    : root === 'documents'
                      ? '~/Documents'
                      : root === 'desktop'
                        ? '~/Desktop'
                        : 'Project'}
                  {currentDir ? `/${currentDir}` : ''}
                </code>{' '}
                on your Mac/Windows PC over LAN or Cloudflare HTTPS tunnel.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => void handleUploadFiles(e.target.files)}
              className="hidden"
            />
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={!isConnected || uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#88f1d1]/45 bg-[#88f1d1]/8 p-4 text-center disabled:opacity-40"
            >
              {uploading ? (
                <Loader2 className="h-7 w-7 animate-spin text-[#88f1d1]" />
              ) : (
                <Upload className="h-7 w-7 text-[#88f1d1]" />
              )}
              <div className="text-xs font-extrabold text-white">
                {uploading ? 'Sending to Computer…' : 'Tap to Choose Photos or Files'}
              </div>
              <div className="text-[9.5px] text-[#9cb4bb]">Up to 25 MB per file · Instant transfer</div>
            </motion.button>
          </div>

          <div className="flex min-h-0 flex-col gap-1.5 rounded-2xl border border-white/[0.08] bg-black/45 p-3 md:col-span-7">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1 rounded-full bg-black/70 p-0.5">
                {(['downloads', 'documents', 'desktop', 'project'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRoot(r);
                      setCurrentDir('');
                    }}
                    className="rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase"
                    style={{
                      background: root === r ? '#182c35' : 'transparent',
                      color: root === r ? '#88f1d1' : '#7c8190',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {currentDir ? (
                <button
                  type="button"
                  onClick={goParentDir}
                  className="flex shrink-0 items-center gap-0.5 rounded-lg bg-white/[0.08] px-2 py-0.5 text-[9px] font-bold text-white"
                >
                  <ArrowUp className="h-2.5 w-2.5" />
                  Up
                </button>
              ) : (
                <span className="font-mono-tech text-[9.5px] text-[#9cb4bb]">
                  Computer → iPhone
                </span>
              )}
            </div>

            <div className="deck-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
              {entries.map((entry) =>
                entry.isDir ? (
                  <button
                    key={entry.relPath}
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setCurrentDir(entry.relPath);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-left hover:bg-white/[0.06]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Folder className="h-3.5 w-3.5 shrink-0 text-[#fbbf24]" />
                      <div className="truncate text-[11px] font-bold text-white">{entry.name}</div>
                    </div>
                    <span className="font-mono-tech text-[9px] text-[#fbbf24]">Open →</span>
                  </button>
                ) : (
                  <div
                    key={entry.relPath}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <File className="h-3.5 w-3.5 shrink-0 text-[#7dd3fc]" />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-bold text-white">{entry.name}</div>
                        <div className="font-mono-tech text-[9px] text-zinc-400">
                          {formatBytes(entry.sizeBytes)}
                        </div>
                      </div>
                    </div>
                    <a
                      href={downloadUrl(entry.relPath)}
                      download={entry.name}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-[#7dd3fc]/20 px-2.5 py-1 text-[9.5px] font-extrabold text-[#7dd3fc]"
                    >
                      <Download className="h-3 w-3" />
                      Get
                    </a>
                  </div>
                ),
              )}
              {entries.length === 0 && (
                <div className="sub grid h-28 place-items-center text-center">
                  {isConnected ? 'Folder is empty' : 'Connect computer bridge to browse files'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REMOTE FILE EXPLORER & QUICK CODE EDITOR */}
      {tab === 'explorer' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-12">
          {/* File Tree & Search */}
          <div className="flex min-h-0 flex-col gap-1.5 rounded-2xl border border-white/[0.08] bg-black/50 p-2.5 md:col-span-5">
            <div className="flex flex-wrap items-center gap-1">
              {(['project', 'documents', 'desktop', 'downloads'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRoot(r);
                    setCurrentDir('');
                    setOpenFilePath(null);
                  }}
                  className="rounded-lg px-2 py-0.5 text-[9px] font-extrabold uppercase"
                  style={{
                    background: root === r ? '#7dd3fc26' : 'rgba(255,255,255,0.04)',
                    color: root === r ? '#7dd3fc' : '#7c8190',
                  }}
                >
                  {r}
                </button>
              ))}
              {currentDir && (
                <button
                  type="button"
                  onClick={goParentDir}
                  className="ml-auto flex items-center gap-0.5 rounded-lg bg-white/[0.08] px-2 py-0.5 text-[9px] font-bold text-white"
                >
                  <ArrowUp className="h-2.5 w-2.5" />
                  Up
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute top-1.5 left-2.5 h-3 w-3 text-[#7c8190]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files (e.g. .env, package.json)…"
                className="font-mono-tech w-full rounded-full border border-white/10 bg-[#081217] py-1 pr-2.5 pl-7 text-[10px] text-white outline-none"
              />
            </div>

            <div className="deck-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
              {entries.map((entry) => (
                <button
                  key={entry.relPath}
                  type="button"
                  onClick={() => void handleOpenFile(entry)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-white/[0.06]"
                  style={{
                    background: openFilePath === entry.relPath ? 'rgba(125,211,252,0.16)' : undefined,
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    {entry.isDir ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-[#fbbf24]" />
                    ) : (
                      <Code2 className="h-3.5 w-3.5 shrink-0 text-[#88f1d1]" />
                    )}
                    <span className="font-mono-tech truncate text-[10.5px] text-white">
                      {query ? entry.relPath : entry.name}
                    </span>
                  </div>
                  {!entry.isDir && (
                    <span className="font-mono-tech shrink-0 text-[8.5px] text-zinc-500">
                      {formatBytes(entry.sizeBytes)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Code Editor */}
          <div className="flex min-h-0 flex-col gap-1.5 rounded-2xl border border-white/[0.08] bg-[#060f14] p-2.5 md:col-span-7">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-tech truncate text-[10.5px] font-bold text-[#88f1d1]">
                {openFilePath || 'Select any file to view or edit (.env, .json, .ts, .md)'}
              </span>
              {openFilePath && (
                <div className="flex items-center gap-1.5">
                  <a
                    href={downloadUrl(openFilePath)}
                    download={openFilePath.split('/').pop()}
                    className="rounded-lg bg-white/[0.08] px-2 py-1 text-[9px] font-bold text-[#7dd3fc]"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    disabled={!fileDirty || savingFile}
                    onClick={() => void handleSaveFile()}
                    className="flex items-center gap-1 rounded-lg bg-[#88f1d1] px-2.5 py-1 text-[9.5px] font-extrabold text-[#061c17] disabled:opacity-40"
                  >
                    {savingFile ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    {fileDirty ? 'Save Changes' : 'Saved'}
                  </button>
                </div>
              )}
            </div>
            <textarea
              value={fileContent}
              onChange={(e) => {
                setFileContent(e.target.value);
                setFileDirty(true);
              }}
              disabled={!openFilePath}
              spellCheck={false}
              placeholder="Tap any code or config file on the left to inspect & edit it directly from your phone…"
              className="deck-scroll font-mono-tech min-h-0 flex-1 resize-none rounded-xl border border-white/[0.07] bg-[#040a0e] p-2.5 text-[11px] leading-relaxed text-[#d4f5e9] outline-none focus:border-[#88f1d1]/50"
            />
          </div>
        </div>
      )}

      {/* TAB 3: CLIPBOARD SYNC (TEXT + IMAGES & SEARCH) */}
      {tab === 'clipboard' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 md:grid-cols-12">
          {/* Bidirectional Image / Screenshot Clipboard */}
          <div className="flex min-h-0 flex-col justify-between gap-2 rounded-2xl border border-[#fbbf24]/30 bg-[#0a151c] p-3 md:col-span-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#fbbf24]">
                <ImageIcon className="h-4 w-4" />
                Screenshot &amp; Image Clipboard
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!isConnected || clipImgLoading}
                  onClick={() => void handlePullClipboardImage()}
                  className="rounded-lg bg-white/[0.08] px-2 py-1 text-[9px] font-extrabold text-white"
                >
                  Pull from PC
                </button>
                <input
                  ref={clipImgInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePushClipboardImage(e.target.files)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={!isConnected || clipImgLoading}
                  onClick={() => clipImgInputRef.current?.click()}
                  className="rounded-lg bg-[#fbbf24] px-2 py-1 text-[9px] font-extrabold text-[#161004]"
                >
                  Send Photo → PC
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-black/60 p-2">
              {clipImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={clipImage}
                  alt="Synced clipboard image"
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              ) : (
                <div className="sub text-center text-[10.5px]">
                  Tap <b>Pull from PC</b> to grab your computer&apos;s copied screenshot, or{' '}
                  <b>Send Photo → PC</b> to put an iPhone photo onto your Mac/Windows clipboard!
                </div>
              )}
            </div>

            {clipImage && (
              <a
                href={clipImage}
                download={`devdeck-clipboard-${Date.now()}.png`}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#88f1d1] py-1.5 text-[10.5px] font-extrabold text-[#061c17]"
              >
                <Download className="h-3.5 w-3.5" />
                Save Screenshot to iPhone
              </a>
            )}
          </div>

          {/* Searchable Text Clipboard History + Send to Computer */}
          <div className="flex min-h-0 flex-col gap-1.5 rounded-2xl border border-white/[0.08] bg-black/45 p-3 md:col-span-7">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!clipTextInput.trim()) return;
                soundEngine.playClick();
                deck.sendEvent({
                  type: 'clipboard:copy',
                  payload: { requestId: makeRequestId(), text: clipTextInput, autoPaste: false },
                });
                setClipTextInput('');
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={clipTextInput}
                onChange={(e) => setClipTextInput(e.target.value)}
                placeholder="Type or paste text to send to computer clipboard…"
                className="font-mono-tech min-w-0 flex-1 rounded-full border border-white/10 bg-[#081217] px-3 py-1 text-[10.5px] text-white outline-none"
              />
              <button
                type="submit"
                disabled={!isConnected || !clipTextInput.trim()}
                className="flex shrink-0 items-center gap-1 rounded-full bg-[#88f1d1] px-3 py-1 text-[10px] font-extrabold text-[#061c17] disabled:opacity-40"
              >
                <Send className="h-3 w-3" />
                Copy to PC
              </button>
            </form>

            <div className="relative">
              <Search className="pointer-events-none absolute top-1.5 left-2.5 h-3 w-3 text-[#7c8190]" />
              <input
                type="search"
                value={clipSearch}
                onChange={(e) => setClipSearch(e.target.value)}
                placeholder={`Search ${deck.clipboard.history.length} clipboard items…`}
                className="font-mono-tech w-full rounded-full border border-white/10 bg-[#081217] py-1 pr-2.5 pl-7 text-[10px] text-white outline-none"
              />
            </div>

            <div className="deck-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
              {filteredClipboard.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.035] px-2.5 py-1.5"
                >
                  <p className="font-mono-tech line-clamp-2 min-w-0 flex-1 text-[10.5px] text-zinc-200">
                    {item.text}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        void navigator.clipboard?.writeText(item.text);
                        deck.showToast(true, 'Copied to iPhone clipboard');
                      }}
                      className="rounded-lg bg-white/[0.08] px-2 py-1 text-[9px] font-bold text-[#7dd3fc]"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'clipboard:copy',
                          payload: { requestId: makeRequestId(), text: item.text, autoPaste: true },
                        });
                      }}
                      className="flex items-center gap-0.5 rounded-lg bg-[#88f1d1]/20 px-2 py-1 text-[9px] font-extrabold text-[#88f1d1]"
                    >
                      <Check className="h-3 w-3" />
                      Paste
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
