import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CheckoutVsHead, Task } from '../../../shared/types';
import { useGit, useTaskBranch } from '../../stores/gitStore';
import { modeReviewOf, usePrReviews } from '../../stores/prReviewStore';
import { anyDirtyUnder, dirtyVersion, subscribeDirty } from '../diffEditor/models';
import { checkoutNotice, nextLiveAt, reviewCheckout, type ReviewCheckout } from './checkout';

/**
 * What the diff's right side is in the task's review mode (see
 * `reviewCheckout`), and the notice saying how the checkout differs from the
 * PR. The checkout is measured against the PR head in main, again each time
 * HEAD moves; unsaved edits in the editor count as uncommitted
 * changes. Out of review mode, or until its PR has loaded: not live, no
 * notice. Its own hook, not `useReviewMode`'s: the editor's workspace takes
 * `live`, and `useReviewMode` takes the workspace.
 */
export function useReviewCheckout(
  task: Pick<Task, 'id' | 'branch' | 'path' | 'projectId'>,
): ReviewCheckout & { notice: string | null } {
  const review = usePrReviews(modeReviewOf(task.id));
  const status = useGit((s) => (s.gitStatusCwd === task.path ? s.gitStatus : null));
  const taskBranch = useTaskBranch(task);
  const branch = status ? status.branch : taskBranch;
  const head = review?.head ?? null;
  const headSha = status?.headSha ?? null;
  const [facts, setFacts] = useState<{ head: string; at: CheckoutVsHead | null } | null>(null);

  useEffect(() => {
    if (!head) return;
    let live = true;
    void window.electronAPI
      .prReviewCheckout({ cwd: task.path, head })
      .then((r) => live && setFacts({ head, at: r.success ? (r.data ?? null) : null }))
      .catch(() => live && setFacts({ head, at: null }));
    return () => {
      live = false;
    };
    // `headSha` is a trigger: a commit, checkout, pull or reset.
  }, [task.path, head, headSha]);

  useSyncExternalStore(subscribeDirty, dirtyVersion);
  // Unknown (null) until the task's own status is in: a task switched to
  // still shows the last one's.
  const uncommitted = anyDirtyUnder(task.path) || (status ? status.files.length > 0 : null);
  // The head the right side was last live at: edits made there keep it live,
  // across a task switch too (the store's, not this mount's).
  const liveAt = usePrReviews((s) => s.liveHeads[task.id] ?? null);
  const at = facts && facts.head === head ? facts.at : null;
  const result = review
    ? reviewCheckout({
        facts: at,
        branch,
        headRef: review.headRef,
        uncommitted,
        wasLive: liveAt !== null && liveAt === head,
      })
    : { live: false, differences: [] };
  // Out of review mode it is forgotten: entering again starts afresh (D124).
  const next = review ? nextLiveAt({ live: result.live, head, facts: at, liveAt }) : null;
  useEffect(() => {
    usePrReviews.getState().setLiveHead(task.id, next);
  }, [task.id, next]);
  return { ...result, notice: checkoutNotice(result.differences) };
}
