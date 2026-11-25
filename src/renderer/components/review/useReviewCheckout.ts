import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CheckoutVsHead, PrReview, Task } from '../../../shared/types';
import { useGit, useTaskBranch } from '../../stores/gitStore';
import { anyDirtyUnder, dirtyVersion, subscribeDirty } from '../diffEditor/models';
import { checkoutNotice, reviewCheckout, type ReviewCheckout } from './checkout';

/**
 * What the diff's right side is in review mode (see `reviewCheckout`), and
 * the notice saying how the checkout differs from the PR. The checkout is
 * measured against the PR head in main, again on each git status change;
 * unsaved edits in the editor count as uncommitted changes. Out of review
 * mode (`review` null): not live, no notice.
 */
export function useReviewCheckout(
  task: Pick<Task, 'id' | 'branch' | 'path'>,
  review: Pick<PrReview, 'head' | 'headRef'> | null,
): ReviewCheckout & { notice: string | null } {
  const status = useGit((s) => (s.gitStatusCwd === task.path ? s.gitStatus : null));
  const taskBranch = useTaskBranch(task);
  const branch = status ? status.branch : taskBranch;
  const head = review?.head ?? null;
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
    // `status` is a trigger: a commit, checkout, pull or push.
  }, [task.path, head, status]);

  useSyncExternalStore(subscribeDirty, dirtyVersion);
  const uncommitted = (status?.files.length ?? 0) > 0 || anyDirtyUnder(task.path);
  // The head the right side was last live at: edits made there keep it live.
  const liveAt = useRef<string | null>(null);
  const at = facts && facts.head === head ? facts.at : null;
  const result = review
    ? reviewCheckout({
        facts: at,
        branch,
        headRef: review.headRef,
        uncommitted,
        wasLive: liveAt.current === head,
      })
    : { live: false, differences: [] };
  useEffect(() => {
    if (result.live) liveAt.current = head;
    else if (!at?.atHead) liveAt.current = null;
  });
  return { ...result, notice: checkoutNotice(result.differences) };
}
