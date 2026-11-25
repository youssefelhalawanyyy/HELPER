import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type FileRootKey = 'project' | 'desktop' | 'downloads' | 'documents';

export interface WorkspaceFileEntry {
  name: string;
  relPath: string;
  isDir: boolean;
  sizeBytes: number;
  mtimeMs: number;
  ext: string;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  '.turbo',
  '.cache',
  '__pycache__',
  'build',
]);

export function resolveRootDir(root: FileRootKey, projectDir: string): string {
  const home = os.homedir();
  if (root === 'desktop') return path.join(home, 'Desktop');
  if (root === 'downloads') return path.join(home, 'Downloads');
  if (root === 'documents') return path.join(home, 'Documents');
  return path.resolve(projectDir);
}

export function resolveSafePath(rootDir: string, relPath = ''): string {
  const normalizedBase = path.resolve(rootDir);
  const cleaned = String(relPath || '').replace(/^[/\\]+/, '');
  const full = path.resolve(normalizedBase, cleaned);
  if (full !== normalizedBase && !full.startsWith(normalizedBase + path.sep)) {
    throw new Error('Access outside allowed directory is blocked');
  }
  return full;
}

export function listWorkspaceFiles(
  root: FileRootKey,
  projectDir: string,
  relDir = '',
  query = '',
): { rootDir: string; currentDir: string; entries: WorkspaceFileEntry[] } {
  const rootDir = resolveRootDir(root, projectDir);
  fs.mkdirSync(rootDir, { recursive: true });
  const targetDir = resolveSafePath(rootDir, relDir);
  const q = query.trim().toLowerCase();

  if (q) {
    const matches: WorkspaceFileEntry[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 4 || matches.length >= 80) return;
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (matches.length >= 80) break;
        if (item.isDirectory() && IGNORED_DIRS.has(item.name)) continue;
        const full = path.join(dir, item.name);
        const rel = path.relative(rootDir, full).replace(/\\/g, '/');
        if (item.name.toLowerCase().includes(q) || rel.toLowerCase().includes(q)) {
          try {
            const st = fs.statSync(full);
            matches.push({
              name: item.name,
              relPath: rel,
              isDir: item.isDirectory(),
              sizeBytes: item.isDirectory() ? 0 : st.size,
              mtimeMs: st.mtimeMs,
              ext: item.isDirectory() ? '' : path.extname(item.name).toLowerCase(),
            });
          } catch {
            // Skip unreadable
          }
        }
        if (item.isDirectory()) {
          walk(full, depth + 1);
        }
      }
    };
    walk(targetDir, 0);
    matches.sort((a, b) => Number(b.isDir) - Number(a.isDir) || b.mtimeMs - a.mtimeMs);
    return {
      rootDir,
      currentDir: path.relative(rootDir, targetDir).replace(/\\/g, '/'),
      entries: matches,
    };
  }

  let items: fs.Dirent[] = [];
  try {
    items = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch {
    items = [];
  }

  const entries: WorkspaceFileEntry[] = [];
  for (const item of items) {
    if (item.name === '.DS_Store' || item.name === 'Thumbs.db') continue;
    const full = path.join(targetDir, item.name);
    try {
      const st = fs.statSync(full);
      entries.push({
        name: item.name,
        relPath: path.relative(rootDir, full).replace(/\\/g, '/'),
        isDir: item.isDirectory(),
        sizeBytes: item.isDirectory() ? 0 : st.size,
        mtimeMs: st.mtimeMs,
        ext: item.isDirectory() ? '' : path.extname(item.name).toLowerCase(),
      });
    } catch {
      // Ignore permission denied entries
    }
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (root === 'downloads' || root === 'desktop' || root === 'documents') return b.mtimeMs - a.mtimeMs;
    return a.name.localeCompare(b.name);
  });

  return {
    rootDir,
    currentDir: path.relative(rootDir, targetDir).replace(/\\/g, '/'),
    entries: entries.slice(0, 150),
  };
}

export function readWorkspaceTextFile(
  root: FileRootKey,
  projectDir: string,
  relPath: string,
): { relPath: string; content: string; sizeBytes: number; truncated: boolean } {
  const rootDir = resolveRootDir(root, projectDir);
  const full = resolveSafePath(rootDir, relPath);
  const st = fs.statSync(full);
  if (st.isDirectory()) throw new Error('Cannot read a directory as text');
  const maxBytes = 400 * 1024;
  const buf = fs.readFileSync(full);
  const truncated = buf.byteLength > maxBytes;
  const content = (truncated ? buf.subarray(0, maxBytes) : buf).toString('utf8');
  return {
    relPath: path.relative(rootDir, full).replace(/\\/g, '/'),
    content,
    sizeBytes: st.size,
    truncated,
  };
}

export function writeWorkspaceTextFile(
  root: FileRootKey,
  projectDir: string,
  relPath: string,
  content: string,
): { relPath: string; bytes: number } {
  const rootDir = resolveRootDir(root, projectDir);
  const full = resolveSafePath(rootDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return {
    relPath: path.relative(rootDir, full).replace(/\\/g, '/'),
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

export function saveUploadedFile(
  root: FileRootKey,
  projectDir: string,
  filename: string,
  base64Data: string,
  subDir = '',
): { filename: string; fullPath: string; relPath: string; bytes: number } {
  const rootDir = resolveRootDir(root, projectDir);
  const safeName = path.basename(filename || `drop-${Date.now()}.bin`).replace(/[<>:"|?*]/g, '_');
  const targetDir = resolveSafePath(rootDir, subDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const stripped = base64Data.includes(',') ? base64Data.split(',')[1] || '' : base64Data;
  const buffer = Buffer.from(stripped, 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > 25 * 1024 * 1024) {
    throw new Error('File must be between 1 byte and 25 MB');
  }

  let finalPath = path.join(targetDir, safeName);
  if (fs.existsSync(finalPath)) {
    const ext = path.extname(safeName);
    const stem = path.basename(safeName, ext);
    finalPath = path.join(targetDir, `${stem}-${Date.now().toString().slice(-4)}${ext}`);
  }
  fs.writeFileSync(finalPath, buffer);
  return {
    filename: path.basename(finalPath),
    fullPath: finalPath,
    relPath: path.relative(rootDir, finalPath).replace(/\\/g, '/'),
    bytes: buffer.byteLength,
  };
}
