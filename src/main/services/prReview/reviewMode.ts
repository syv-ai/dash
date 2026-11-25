import type { PrRef, RelevantPrs, TaskPrs } from '@shared/types';

/** What review mode takes: where it is kept, and the task's relevant PRs. */
export interface ReviewModeDeps {
  /** The PR the task is in review mode for (`taskReviewModesRepo`), or null. */
  storedMode(taskId: string): PrRef | null;
  storeMode(taskId: string, pr: PrRef | null): void;
  /** The open PRs from and into the task's live branch. Rejects when the
   *  forge can't be asked (no remote, ADO not configured, gh offline). */
  relevantPrs(taskId: string): Promise<RelevantPrs>;
}

const samePr = (a: PrRef, b: PrRef) => a.provider === b.provider && a.number === b.number;

/** Review mode for `mode` holds while the PR is open and from or into the
 *  task's branch (D-R3a): merged, closed, or the branch moved off it, it ends. */
export function reviewModeHolds(mode: PrRef, relevant: RelevantPrs): boolean {
  return [...relevant.from, ...relevant.into].some((p) => samePr(p, mode));
}

/** The stored mode, ended (and cleared) when it no longer holds. */
function liveMode(taskId: string, relevant: RelevantPrs, deps: ReviewModeDeps): PrRef | null {
  const stored = deps.storedMode(taskId);
  if (!stored || reviewModeHolds(stored, relevant)) return stored;
  deps.storeMode(taskId, null);
  return null;
}

/**
 * The task's relevant PRs and the PR it is in review mode for, ending a mode
 * that no longer holds. When the forge can't be asked, `relevant` is null and
 * the mode stays as stored: offline says nothing about the PR.
 */
export async function settleReviewMode(taskId: string, deps: ReviewModeDeps): Promise<TaskPrs> {
  const relevant = await deps.relevantPrs(taskId).catch(() => null);
  if (!relevant) return { relevant: null, mode: deps.storedMode(taskId) };
  return { relevant, mode: liveMode(taskId, relevant, deps) };
}

/**
 * The PR `dashctl review` works on without `--number` (D-R3b): the one the
 * task is in review mode for, else the newest open PR from its branch, else
 * null. When the forge can't be asked, a stored mode still answers; without
 * one the forge's error does.
 */
export async function defaultReviewPr(taskId: string, deps: ReviewModeDeps): Promise<PrRef | null> {
  let relevant: RelevantPrs;
  try {
    relevant = await deps.relevantPrs(taskId);
  } catch (err) {
    const stored = deps.storedMode(taskId);
    if (stored) return stored;
    throw err;
  }
  const mode = liveMode(taskId, relevant, deps);
  if (mode) return mode;
  const own = relevant.from[0];
  return own ? { provider: own.provider, number: own.number } : null;
}
