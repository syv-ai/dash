import type { CiState, PullRequestInfo } from '@shared/types';

/**
 * The PRs worth showing for a branch, newest first: every open one; with none
 * open, the newest merged or closed PR, but only while the branch has not moved
 * past its last commit. Once a developer keeps working after a merge, the old
 * PR is history and the branch reads as ready for a new one. A PR without a
 * known head commit, or one `movedPast` can't place, is kept rather than
 * guessed away.
 */
export async function relevantPrs(
  prs: PullRequestInfo[],
  movedPast: (sha: string) => Promise<boolean>,
): Promise<PullRequestInfo[]> {
  const newestFirst = [...prs].sort((a, b) => b.number - a.number);
  const open = newestFirst.filter((p) => p.state === 'open');
  if (open.length > 0) return open;
  const last = newestFirst[0];
  if (!last) return [];
  if (last.headSha && (await movedPast(last.headSha))) return [];
  return [last];
}

/** One entry of `gh pr list --json statusCheckRollup`: a check run or a commit status. */
interface RollupEntry {
  __typename?: string;
  status?: string | null; // CheckRun: QUEUED | IN_PROGRESS | COMPLETED | …
  conclusion?: string | null; // CheckRun: SUCCESS | FAILURE | SKIPPED | …
  state?: string | null; // StatusContext: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
}

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);
const RUNNING = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED']);

/** A GitHub PR's checks as one state: any failure fails it, then any still running; null without checks. */
export function ciFromRollup(rollup: unknown): CiState | null {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  let running = false;
  for (const raw of rollup as RollupEntry[]) {
    const outcome = raw.conclusion || raw.state || '';
    if (FAILED.has(outcome)) return 'failing';
    const notDone = raw.status ? raw.status !== 'COMPLETED' : RUNNING.has(raw.state ?? '');
    if (notDone) running = true;
  }
  return running ? 'pending' : 'passing';
}
