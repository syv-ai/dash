import type { CiState, PullRequestInfo } from '@shared/types';

/**
 * Every PR from a branch, newest first, with `current` set on the ones that
 * stand for it now: every open one; with none open, the newest merged or
 * closed PR, but only until the branch has a commit past its last one. Once
 * a developer commits after a merge, the old PR is history (still listed) and
 * the branch reads as ready for a new one. A PR without a known head commit,
 * or one `movedPast` can't place, stays current rather than guessed away.
 */
export async function relevantPrs(
  prs: PullRequestInfo[],
  movedPast: (sha: string) => Promise<boolean>,
): Promise<PullRequestInfo[]> {
  const newestFirst = [...prs].sort((a, b) => b.number - a.number);
  const anyOpen = newestFirst.some((p) => p.state === 'open');
  const last = newestFirst[0];
  const lastIsCurrent = !anyOpen && !!last && !(last.headSha && (await movedPast(last.headSha)));
  return newestFirst.map((p) => ({
    ...p,
    current: p.state === 'open' || (lastIsCurrent && p === last),
  }));
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

// Policy types that are CI: build validation and required external status.
// Reviewer, comment and work-item policies say nothing about the checks.
const ADO_CI_POLICY_TYPES = new Set([
  '0609b952-1397-4640-95ec-e00a01b2c241', // Build
  'cbdc66da-9728-4af8-aada-9a5a32e4a226', // Status
]);

interface AdoPolicyEvaluation {
  status?: string; // queued | running | approved | rejected | notApplicable | broken
  configuration?: { type?: { id?: string } };
}

interface AdoPrStatus {
  id?: number;
  state?: string; // notSet | pending | succeeded | failed | error | notApplicable
  context?: { name?: string; genre?: string };
}

/**
 * An Azure DevOps PR's checks as one state, from its policy evaluations (build
 * validation, required statuses) and the statuses posted to it, latest per
 * context. Same rule as ciFromRollup; null without any CI check.
 */
export function ciFromAdo(evaluations: unknown, statuses: unknown): CiState | null {
  const outcomes: Array<'failing' | 'pending' | 'passing'> = [];
  for (const e of (Array.isArray(evaluations) ? evaluations : []) as AdoPolicyEvaluation[]) {
    if (!ADO_CI_POLICY_TYPES.has(e.configuration?.type?.id ?? '')) continue;
    if (e.status === 'rejected' || e.status === 'broken') outcomes.push('failing');
    else if (e.status === 'queued' || e.status === 'running') outcomes.push('pending');
    else if (e.status === 'approved') outcomes.push('passing');
  }
  const latest = new Map<string, AdoPrStatus>();
  for (const s of (Array.isArray(statuses) ? statuses : []) as AdoPrStatus[]) {
    const key = `${s.context?.genre ?? ''}/${s.context?.name ?? ''}`;
    const prev = latest.get(key);
    if (!prev || (s.id ?? 0) > (prev.id ?? 0)) latest.set(key, s);
  }
  for (const s of latest.values()) {
    if (s.state === 'failed' || s.state === 'error') outcomes.push('failing');
    else if (s.state === 'pending') outcomes.push('pending');
    else if (s.state === 'succeeded') outcomes.push('passing');
  }
  if (outcomes.length === 0) return null;
  if (outcomes.includes('failing')) return 'failing';
  return outcomes.includes('pending') ? 'pending' : 'passing';
}
