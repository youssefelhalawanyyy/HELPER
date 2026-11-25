import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, name);
  writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
  renameSync(file + '.tmp', file);
}
