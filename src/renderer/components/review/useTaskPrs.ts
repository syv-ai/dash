import { useEffect } from 'react';
import type { PrRef, RelevantPrs, Task } from '../../../shared/types';
import { useGit, useTaskBranch } from '../../stores/gitStore';
import { prKey, usePrReviews } from '../../stores/prReviewStore';

export interface TaskPrsView {
  /** The open PRs from and into the task's branch; null until first listed. */
  relevant: RelevantPrs | null;
  /** The PR the task is in review mode for; null in normal mode, undefined
   *  until main has said. */
  mode: PrRef | null | undefined;
  /** List again (the PR button opening). */
  refresh: () => void;
}

/**
 * The task's relevant PRs and review mode, as main settles them (a mode whose
 * PR merged, closed or left the branch ends there). Asked again on a task
 * switch, a branch change, a change in the branch's own PRs, and when the
 * review-mode PR's loaded state changes (D-R3a).
 */
export function useTaskPrs(task: Pick<Task, 'id' | 'branch'>): TaskPrsView {
  const taskId = task.id;
  const entry = usePrReviews((s) => s.prs[taskId]);
  const branch = useTaskBranch(task);
  const ownPrs = useGit((s) => s.prByTask[taskId]?.map((p) => `${p.number}:${p.state}`).join());
  const modeState = usePrReviews((s) => {
    const mode = s.prs[taskId]?.mode;
    return mode ? s.byPr[prKey(mode.provider, mode.number)]?.state : undefined;
  });
  useEffect(() => {
    void usePrReviews.getState().loadPrs(taskId);
  }, [taskId, branch, ownPrs, modeState]);
  return {
    relevant: entry?.relevant ?? null,
    mode: entry ? entry.mode : undefined,
    refresh: () => void usePrReviews.getState().loadPrs(taskId),
  };
}
