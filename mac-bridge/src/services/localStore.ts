import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../../data/metrics/', import.meta.url));

export function loadLocal<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function saveLocal(name: string, value: unknown) {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, name);
    const serialized = JSON.stringify(value);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, serialized, { mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      // Windows NTFS / Defender fallback when atomic rename over existing file returns EPERM/EBUSY
      try {
        unlinkSync(tmp);
      } catch {}
      writeFileSync(file, serialized, { mode: 0o600 });
    }
  } catch {
    // Never crash bridge if metrics directory is temporarily locked
  }
}
