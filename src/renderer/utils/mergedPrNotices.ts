import type { PullRequestInfo } from '../../shared/types';

/** Per task, the PR last seen for it as `<number>:<state>`. */
export type SeenPrStates = Record<string, string>;

/**
 * Which tasks' PRs were just merged, and the states to remember next.
 *
 * A task is offered for archiving only when its PR was seen in another state
 * before, so a merge that happened while Dash was closed is still caught, but
 * a PR that was already merged the first time Dash looks stays quiet (no
 * burst of toasts for old tasks). A null PR (none, or a failed fetch) keeps
 * what was seen. Only tasks in `taskIds` are offered; nothing is forgotten,
 * since a task missing from it may only belong to a project not loaded yet.
 */
export function newlyMergedPrs(
  seen: SeenPrStates,
  prByTask: Record<string, PullRequestInfo | null>,
  taskIds: Set<string>,
  isArchived: (taskId: string) => boolean,
): { merged: string[]; next: SeenPrStates } {
  const next: SeenPrStates = { ...seen };
  const merged: string[] = [];
  for (const [taskId, pr] of Object.entries(prByTask)) {
    if (!pr) continue;
    const key = `${pr.number}:${pr.state}`;
    const before = next[taskId];
    next[taskId] = key;
    const offered = taskIds.has(taskId) && !isArchived(taskId);
    if (pr.state === 'merged' && before !== undefined && before !== key && offered) {
      merged.push(taskId);
    }
  }
  return { merged, next };
}
