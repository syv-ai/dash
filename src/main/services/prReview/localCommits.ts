import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CheckoutVsHead, PrFile } from '@shared/types';

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
 * ones from origin by sha in one go, then, for any still missing,
 * `fallbackRefs` (a PR's own ref, which holds its head even from a fork).
 * GitHub serves any reachable commit by its sha; whether Azure Repos does
 * isn't documented, so its PR ref is the fallback there.
 */
export async function ensureCommits(
  cwd: string,
  shas: string[],
  run: RunGit = runGit,
  fallbackRefs: readonly string[] = [],
): Promise<void> {
  const wanted = [...new Set(shas.filter(Boolean))];
  const absent = async (list: string[]) => {
    const out: string[] = [];
    for (const sha of list) if (!(await has(cwd, sha, run))) out.push(sha);
    return out;
  };
  let missing = await absent(wanted);
  if (missing.length === 0) return;
  await run(cwd, ['fetch', '--no-tags', 'origin', ...missing], 60_000).catch(() => '');
  missing = await absent(missing);
  if (missing.length > 0 && fallbackRefs.length > 0) {
    await run(cwd, ['fetch', '--no-tags', 'origin', ...fallbackRefs], 60_000).catch(() => '');
    missing = await absent(missing);
  }
  if (missing.length > 0) throw new Error(`Could not fetch ${missing[0]} from origin`);
}

/**
 * Lines added and deleted on `head` since its merge-base with `base` (`git
 * diff --shortstat base...head`); null unless both commits are in the
 * checkout already, since nothing is fetched for it, or git can't say.
 */
export async function localDiffStat(
  cwd: string,
  base: string,
  head: string,
  run: RunGit = runGit,
): Promise<{ additions: number; deletions: number } | null> {
  if (!base || !head || !(await has(cwd, base, run)) || !(await has(cwd, head, run))) return null;
  try {
    const out = await run(cwd, ['diff', '--shortstat', `${base}...${head}`], 15_000);
    const count = (what: string) => Number(new RegExp(`(\\d+) ${what}`).exec(out)?.[1] ?? 0);
    return { additions: count('insertion'), deletions: count('deletion') };
  } catch {
    return null;
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
 * count over base..head, and how far the base branch's tip (as the forge
 * reports it, present in the checkout) has moved past head; null without one.
 */
export async function prLocalStats(
  cwd: string,
  { base, head, baseTip }: { base: string; head: string; baseTip: string | null },
  run: RunGit = runGit,
): Promise<{ files: PrFile[]; commits: number; behindBase: number | null }> {
  const countOf = (out: string) => Number(out.trim()) || 0;
  const [diff, commits, behindBase] = await Promise.all([
    run(cwd, ['diff', '-z', '--raw', '--numstat', '-M', '--no-abbrev', base, head], 30_000),
    run(cwd, ['rev-list', '--count', `${base}..${head}`], 15_000).then(countOf),
    baseTip
      ? run(cwd, ['rev-list', '--count', `${head}..${baseTip}`], 15_000).then(countOf, () => null)
      : Promise.resolve(null),
  ]);
  return { files: parseRawNumstat(diff), commits, behindBase };
}

/**
 * Where the checkout at `cwd` stands against PR head `head`: whether HEAD is
 * that commit, and how many commits HEAD has that the head lacks (`ahead`:
 * local commits not pushed to the PR) and the other way round (`behind`).
 * Null when `head` isn't in the checkout (never fetched) or git can't say.
 */
export async function checkoutVsHead(
  cwd: string,
  head: string,
  run: RunGit = runGit,
): Promise<CheckoutVsHead | null> {
  if (!head || !(await has(cwd, head, run))) return null;
  try {
    const [sha, counts] = await Promise.all([
      run(cwd, ['rev-parse', 'HEAD'], 15_000),
      run(cwd, ['rev-list', '--left-right', '--count', `${head}...HEAD`], 15_000),
    ]);
    const [behind = 0, ahead = 0] = counts.trim().split(/\s+/).map(Number);
    return { atHead: sha.trim() === head, ahead, behind };
  } catch {
    return null;
  }
}
