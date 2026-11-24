import { useEffect, useState } from 'react';
import { ArrowUpFromLine } from 'lucide-react';
import type { PrReview, Task, TaskReviewTarget } from '../../../shared/types';
import { useGit, useTaskBranch } from '../../stores/gitStore';
import { onPrHeadBranch, unpushedLine } from './unpushed';

/**
 * "n local commits aren't in the PR yet": shown while the task's checkout is
 * on the PR's head branch and HEAD has commits the PR's head lacks. Counted
 * in main against the head as last loaded, again on each review reload and
 * each change in the checkout's git status; hidden when the head isn't in the
 * checkout.
 */
export function UnpushedNotice({
  task,
  review,
  source,
}: {
  task: Pick<Task, 'id' | 'branch' | 'path'>;
  review: PrReview;
  source: TaskReviewTarget['source'];
}) {
  const branch = useTaskBranch(task);
  const onBranch = onPrHeadBranch(source, review.headRef, branch);
  const status = useGit((s) => (s.gitStatusCwd === task.path ? s.gitStatus : null));
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!onBranch) {
      setCount(null);
      return;
    }
    let live = true;
    void window.electronAPI
      .prReviewLocalAhead({ cwd: task.path, head: review.head })
      .then((r) => live && setCount(r.success ? (r.data ?? null) : null))
      .catch(() => live && setCount(null));
    return () => {
      live = false;
    };
    // `review` and `status` are triggers: a reload or a commit, pull or push.
  }, [onBranch, task.path, review, status]);

  if (!count) return null;
  return (
    <p
      className="type-caption mx-2.5 my-1 flex items-start gap-2 rounded-lg border border-line bg-well px-2.5 py-1.5"
      role="status"
    >
      <ArrowUpFromLine size={14} strokeWidth={1.8} className="shrink-0" />
      <span className="min-w-0 flex-1 tabular-nums">{unpushedLine(count)}</span>
    </p>
  );
}
