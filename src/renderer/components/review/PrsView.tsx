import type { PullRequest, RelevantPrs, Task } from '../../../shared/types';
import { useProjects } from '../../stores/projectsStore';
import { PrDrawer } from './PrDrawer';
import { taskPrList } from './prList';

/**
 * The task sidebar's PRs view (normal mode's, there while the branch has
 * PRs from or into it, `prsTabShown`): a drawer per PR (`PrDrawer`), the
 * branch's own first, then those into it (`taskPrList`); the first open
 * until the person folds it. A drawer's Review enters review mode on it.
 */
export function PrsView({
  task,
  relevant,
  onReview,
}: {
  task: Pick<Task, 'id' | 'path' | 'projectId'>;
  relevant: RelevantPrs | null;
  onReview: (pr: PullRequest) => void;
}) {
  const remote = useProjects(
    (s) => s.projects.find((p) => p.id === task.projectId)?.gitRemote ?? null,
  );
  const at = { projectId: task.projectId, cwd: task.path };
  return (
    <div className="scrollbar-thin-hover h-full min-h-0 overflow-y-auto pt-2 pb-2">
      {taskPrList(relevant).map(({ pr, side }, i) => (
        <PrDrawer
          key={`${pr.provider}:${pr.number}`}
          pr={pr}
          side={side}
          taskId={task.id}
          at={at}
          remote={remote}
          defaultOpen={i === 0}
          onReview={() => onReview(pr)}
        />
      ))}
    </div>
  );
}
