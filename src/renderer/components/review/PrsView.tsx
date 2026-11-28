import type { PullRequest, RelevantPrs, Task } from '../../../shared/types';
import type { ReviewLanding } from '../rightInspector/sidebarState';
import { useProjects } from '../../stores/projectsStore';
import { ListedPr } from './ListedPr';
import { taskPrList } from './prList';

/**
 * The task sidebar's PRs view (normal mode's, there while the branch has
 * PRs from or into it, `prsTabShown`): each PR as review mode draws it
 * (`ListedPr`), the branch's own first, then those into it (`taskPrList`);
 * the first's About open until the person folds it. A PR's Review enters
 * review mode on it.
 */
export function PrsView({
  task,
  relevant,
  onReview,
}: {
  task: Pick<Task, 'id' | 'path' | 'projectId'>;
  relevant: RelevantPrs | null;
  /** Enter review mode on `pr`, on Overview or the view given. */
  onReview: (pr: PullRequest, on?: ReviewLanding) => void;
}) {
  const remote = useProjects(
    (s) => s.projects.find((p) => p.id === task.projectId)?.gitRemote ?? null,
  );
  const at = { projectId: task.projectId, cwd: task.path };
  return (
    <div className="scrollbar-thin-hover h-full min-h-0 overflow-y-auto pt-2 pb-2">
      {taskPrList(relevant).map((pr, i) => (
        <ListedPr
          key={`${pr.provider}:${pr.number}`}
          pr={pr}
          taskId={task.id}
          at={at}
          remote={remote}
          defaultOpen={i === 0}
          onReview={(on) => onReview(pr, on)}
        />
      ))}
    </div>
  );
}
