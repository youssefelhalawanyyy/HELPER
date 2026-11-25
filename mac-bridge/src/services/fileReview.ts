import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const options = (cwd: string) => ({ cwd, timeout: 4000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
const diffArgs = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'];

export async function changedFiles(cwd: string) {
  const [tracked, others] = await Promise.all([
    exec('git', ['diff', '--relative', '--numstat', '-z', ...diffArgs, '--', '.'], options(cwd)),
    exec('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], options(cwd)),
  ]);
  const diffFiles = tracked.stdout
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [, added, removed, file] = /^(\S+)\t(\S+)\t([\s\S]+)$/.exec(record)!;
      return { file, added: Number(added) || 0, removed: Number(removed) || 0 };
    });
  for (const file of others.stdout.split('\0').filter(Boolean))
    diffFiles.push({ file, added: 0, removed: 0 });
  return {
    diffFiles,
    totalAdded: diffFiles.reduce((t, f) => t + f.added, 0),
    totalRemoved: diffFiles.reduce((t, f) => t + f.removed, 0),
  };
}

export async function inspectFile(cwd: string, file: string) {
  if (
    typeof file !== 'string' ||
    !file ||
    path.isAbsolute(file) ||
    file.split(/[\\/]/).some((s) => !s || s === '..' || s === '.' || s.toLowerCase() === '.git')
  )
    throw Error('Invalid file path');
  const entry = await lstat(path.join(cwd, file)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
    return null;
  });
  if (entry?.isDirectory()) throw Error('Choose an individual file');
  const { stdout } = await exec(
    'git',
    ['--literal-pathspecs', 'diff', '--relative', ...diffArgs, '--', file],
    options(cwd),
  );
  let patch = stdout;
  if (!patch) {
    const posixFile = file.replace(/\\/g, '/');
    const result = await exec(
      'git',
      ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', '--', posixFile],
      options(cwd),
    );
    if (result.stdout.replace(/\\/g, '/') === posixFile + '\0' && (await lstat(path.join(cwd, file))).isFile()) {
      const nullDevice = IS_WIN ? 'NUL' : '/dev/null';
      try {
        await exec('git', ['diff', '--no-index', ...diffArgs, '--', nullDevice, posixFile], options(cwd));
      } catch (e) {
        const err = e as { code: number; stdout: string };
        if (err.code !== 1) throw e;
        patch = err.stdout;
      }
    }
  }
  const hasChange = /^(?:@@ |new file mode |deleted file mode |old mode )/m.test(patch);
  const opaque = /^(?:Binary files |GIT binary patch|(?:index .* |(?:new file|deleted file|old|new) mode )160000$)/m.test(patch);
  const complete = patch.length <= 64000 && hasChange && !opaque;
  return {
    file,
    patch: patch.slice(0, 64000),
    revision: complete ? createHash('sha256').update(patch).digest('hex') : undefined,
    added: (patch.match(/^\+(?!\+\+)/gm) || []).length,
    removed: (patch.match(/^-(?!--)/gm) || []).length,
    ts: Date.now(),
  };
}

export async function applyReviewedFile(cwd: string, file: string, revision: string, action: string) {
  if (action !== 'accept' && action !== 'revert') throw Error('Unknown review action');
  const review = await inspectFile(cwd, file);
  if (!review.revision || revision !== review.revision)
    throw Error('File changed or incomplete. Open its diff again.');
  const root = (await exec('git', ['rev-parse', '--show-toplevel'], options(cwd))).stdout.trim();
  const directory = (await exec('git', ['rev-parse', '--show-prefix'], options(cwd))).stdout
    .trimEnd()
    .replace(/\/$/, '');
  const args = ['apply', action === 'accept' ? '--cached' : '--reverse', '--whitespace=nowarn'];
  if (directory) args.push('--directory=' + directory);
  await new Promise<void>((resolve, reject) => {
    const child = execFile('git', args, options(root), (err) =>
      err ? reject(Error('Patch no longer applies. Refresh the diff.')) : resolve(),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(review.patch);
  });
}
