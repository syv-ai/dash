import { execFile } from 'child_process';
import { promisify } from 'util';

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
