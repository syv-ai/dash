import type { CiState, PrCheck, PullRequestInfo } from '@shared/types';

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

/** One entry of a GitHub status check rollup (`gh pr list --json statusCheckRollup`,
 *  or GraphQL's `statusCheckRollup.contexts`): a check run or a commit status. */
interface RollupEntry {
  __typename?: string;
  name?: string | null; // CheckRun
  status?: string | null; // CheckRun: QUEUED | IN_PROGRESS | COMPLETED | …
  conclusion?: string | null; // CheckRun: SUCCESS | FAILURE | SKIPPED | …
  detailsUrl?: string | null; // CheckRun
  context?: string | null; // StatusContext
  state?: string | null; // StatusContext: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
  targetUrl?: string | null; // StatusContext
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
const SKIPPED = new Set(['SKIPPED', 'NEUTRAL']);

/** Checks as one state: any failure fails it, then any still running; null without checks. */
export function ciOf(checks: readonly PrCheck[]): CiState | null {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.state === 'failing')) return 'failing';
  return checks.some((c) => c.state === 'pending') ? 'pending' : 'passing';
}

function githubCheckState(e: RollupEntry): PrCheck['state'] {
  const outcome = e.conclusion || e.state || '';
  if (FAILED.has(outcome)) return 'failing';
  const notDone = e.status ? e.status !== 'COMPLETED' : RUNNING.has(e.state ?? '');
  if (notDone) return 'pending';
  return SKIPPED.has(outcome) ? 'skipped' : 'passing';
}

/** A GitHub PR's checks, one per check run or commit status. */
export function githubChecks(rollup: unknown): PrCheck[] {
  if (!Array.isArray(rollup)) return [];
  return (rollup as (RollupEntry | null)[])
    .filter((e): e is RollupEntry => !!e && typeof e === 'object')
    .map((e) => ({
      name: e.name || e.context || '',
      state: githubCheckState(e),
      url: e.detailsUrl || e.targetUrl || null,
    }));
}

/** A GitHub PR's checks as one state (see ciOf). */
export const ciFromRollup = (rollup: unknown): CiState | null => ciOf(githubChecks(rollup));

// Policy types that are CI: build validation and required external status.
// Reviewer, comment and work-item policies say nothing about the checks.
const BUILD_POLICY = '0609b952-1397-4640-95ec-e00a01b2c241';
const ADO_CI_POLICY_TYPES = new Set([
  BUILD_POLICY,
  'cbdc66da-9728-4af8-aada-9a5a32e4a226', // Status
]);

interface AdoPolicyEvaluation {
  status?: string; // queued | running | approved | rejected | notApplicable | broken
  configuration?: {
    type?: { id?: string; displayName?: string };
    /** Build: displayName; Status: statusGenre / statusName. */
    settings?: { displayName?: string | null; statusName?: string; statusGenre?: string } | null;
  };
  /** A build policy's last build; absent until one is queued. */
  context?: { buildId?: number; isExpired?: boolean } | null;
}

/**
 * A build policy is `queued` whenever it waits for a build, which isn't always
 * one running: its last build may have expired (the target moved on; ADO counts
 * that as a failed required check until someone re-queues), or none was ever
 * queued (a manual build). Only a queued build that exists is pending.
 */
function queuedBuild(e: AdoPolicyEvaluation): 'failing' | 'pending' | null {
  if (e.context?.isExpired) return 'failing';
  return e.context?.buildId ? 'pending' : null;
}

function evaluationState(e: AdoPolicyEvaluation): PrCheck['state'] | null {
  if (e.status === 'rejected' || e.status === 'broken') return 'failing';
  if (e.status === 'queued' && e.configuration?.type?.id === BUILD_POLICY) return queuedBuild(e);
  if (e.status === 'queued' || e.status === 'running') return 'pending';
  return e.status === 'approved' ? 'passing' : null;
}

function evaluationName(e: AdoPolicyEvaluation): string {
  const s = e.configuration?.settings;
  if (s?.displayName) return s.displayName;
  if (s?.statusName) return [s.statusGenre, s.statusName].filter(Boolean).join('/');
  return e.configuration?.type?.displayName ?? 'Policy';
}

interface AdoPrStatus {
  id?: number;
  state?: string; // notSet | pending | succeeded | failed | error | notApplicable
  description?: string;
  targetUrl?: string;
  context?: { name?: string; genre?: string };
}

const STATUS_STATES: Record<string, PrCheck['state']> = {
  failed: 'failing',
  error: 'failing',
  pending: 'pending',
  succeeded: 'passing',
};

/**
 * An Azure DevOps PR's checks, from its policy evaluations (build validation,
 * required statuses) and the statuses posted to it, latest per context. A
 * check that doesn't apply, or a manual build never queued, isn't listed.
 * `buildUrl` links a build policy to its last build.
 */
export function adoChecks(
  evaluations: unknown,
  statuses: unknown,
  buildUrl?: (buildId: number) => string,
): PrCheck[] {
  const checks: PrCheck[] = [];
  for (const e of (Array.isArray(evaluations) ? evaluations : []) as AdoPolicyEvaluation[]) {
    if (!ADO_CI_POLICY_TYPES.has(e.configuration?.type?.id ?? '')) continue;
    const state = evaluationState(e);
    if (!state) continue;
    const buildId = e.context?.buildId;
    checks.push({
      name: evaluationName(e),
      state,
      url: buildId && buildUrl ? buildUrl(buildId) : null,
    });
  }
  const latest = new Map<string, AdoPrStatus>();
  for (const s of (Array.isArray(statuses) ? statuses : []) as AdoPrStatus[]) {
    const key = `${s.context?.genre ?? ''}/${s.context?.name ?? ''}`;
    const prev = latest.get(key);
    if (!prev || (s.id ?? 0) > (prev.id ?? 0)) latest.set(key, s);
  }
  for (const s of latest.values()) {
    const state = STATUS_STATES[s.state ?? ''];
    if (!state) continue;
    const name = [s.context?.genre, s.context?.name].filter(Boolean).join('/');
    checks.push({ name: name || s.description || 'Status', state, url: s.targetUrl || null });
  }
  return checks;
}

/** An Azure DevOps PR's checks as one state (see adoChecks, ciOf). */
export const ciFromAdo = (evaluations: unknown, statuses: unknown): CiState | null =>
  ciOf(adoChecks(evaluations, statuses));
