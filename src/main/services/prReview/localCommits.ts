import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PrFile } from '@shared/types';

const execFileAsync = promisify(execFile);

/** Runs git in `cwd` and returns stdout; rejects on a non-zero exit. */
export type RunGit = (cwd: string, args: string[], timeoutMs: number) => Promise<string>;

export const runGit: RunGit = async (cwd, args, timeout) =>
  (await execFileAsync('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 })).stdout;

const has = (cwd: string, sha: string, run: RunGit) =>
  run(cwd, ['cat-file', '-e', `${sha}^{commit}`], 15_000).then(
    () => true,
    () => false,
  );

/**
 * Make each of `shas` present in the checkout at `cwd`, fetching the missing
 * ones from origin by sha in one go. Both GitHub and Azure Repos serve a
 * reachable commit by its sha.
 */
export async function ensureCommits(
  cwd: string,
  shas: string[],
  run: RunGit = runGit,
): Promise<void> {
  const wanted = [...new Set(shas.filter(Boolean))];
  const missing: string[] = [];
  for (const sha of wanted) if (!(await has(cwd, sha, run))) missing.push(sha);
  if (missing.length === 0) return;
  await run(cwd, ['fetch', '--no-tags', 'origin', ...missing], 60_000).catch(() => '');
  for (const sha of missing) {
    if (!(await has(cwd, sha, run))) throw new Error(`Could not fetch ${sha} from origin`);
  }
}

/** Which of `paths` exist in commit `sha`. */
export async function filesAtCommit(
  cwd: string,
  sha: string,
  paths: string[],
  run: RunGit = runGit,
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const out = await run(cwd, ['ls-tree', '-r', '--name-only', sha, '--', ...paths], 15_000);
  return new Set(out.split('\n').filter(Boolean));
}

const ZERO_SHA = /^0+$/;

/**
 * The files of `git diff -z --raw --numstat -M --no-abbrev`: each file's status
 * and head blob from the raw records, its line counts from the numstat ones
 * (a binary file counts 0/0).
 */
export function parseRawNumstat(out: string): PrFile[] {
  const tokens = out.split('\0');
  const files = new Map<string, PrFile>();
  const stats = new Map<string, { additions: number; deletions: number }>();
  const count = (n: string) => (n === '-' ? 0 : Number(n) || 0);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith(':')) {
      const [, , , dst = '', status = ''] = t.slice(1).split(' ');
      const kind = status[0];
      const renamed = kind === 'R' || kind === 'C';
      const oldPath = renamed ? tokens[++i]! : undefined;
      const path = tokens[++i]!;
      files.set(path, {
        path,
        status:
          kind === 'A' || kind === 'C'
            ? 'added'
            : kind === 'D'
              ? 'deleted'
              : kind === 'R'
                ? 'renamed'
                : 'modified',
        ...(kind === 'R' ? { oldPath } : {}),
        additions: 0,
        deletions: 0,
        blob: kind === 'D' || ZERO_SHA.test(dst) ? null : dst,
      });
      continue;
    }
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(t);
    if (!m) continue;
    let path = m[3]!;
    // A rename's numstat leaves its own path empty; old and new path follow.
    if (!path) path = tokens[(i += 2)]!;
    stats.set(path, { additions: count(m[1]!), deletions: count(m[2]!) });
  }
  return [...files.values()].map((f) => ({ ...f, ...stats.get(f.path) }));
}

/**
 * The local-git facts of a PR, the same on every forge: its files and commit
 * count over base..head, and how far `origin/<baseRef>` has moved past head
 * (null when that ref isn't in the checkout).
 */
export async function prLocalStats(
  cwd: string,
  { base, head, baseRef }: { base: string; head: string; baseRef: string },
  run: RunGit = runGit,
): Promise<{ files: PrFile[]; commits: number; behindBase: number | null }> {
  const countOf = (out: string) => Number(out.trim()) || 0;
  const [diff, commits, behindBase] = await Promise.all([
    run(cwd, ['diff', '-z', '--raw', '--numstat', '-M', '--no-abbrev', base, head], 30_000),
    run(cwd, ['rev-list', '--count', `${base}..${head}`], 15_000).then(countOf),
    baseRef
      ? run(cwd, ['rev-list', '--count', `${head}..refs/remotes/origin/${baseRef}`], 15_000).then(
          countOf,
          () => null,
        )
      : Promise.resolve(null),
  ]);
  return { files: parseRawNumstat(diff), commits, behindBase };
}
