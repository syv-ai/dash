import type { PullRequest, RelevantPrs, Task } from '../../../shared/types';
import type { ReviewLanding } from '../rightInspector/sidebarState';
import { useProjects } from '../../stores/projectsStore';
import { ListedPr } from './ListedPr';
import { prOpenByDefault, taskPrList } from './prList';

/**
 * The task sidebar's PRs view (normal mode's, there while the branch has
 * PRs from or into it, `prsTabShown`): each PR a drawer (`ListedPr`), the
 * branch's own first, then those into it (`taskPrList`); the only PR, or the
 * branch's own, open until the person folds it (`prOpenByDefault`). A PR's
 * Review enters
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
    <div className="scrollbar-thin-hover flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-1 pt-2 pb-2">
      {taskPrList(relevant).map((pr, i) => (
        <ListedPr
          key={`${pr.provider}:${pr.number}`}
          pr={pr}
          taskId={task.id}
          at={at}
          remote={remote}
          defaultOpen={prOpenByDefault(relevant, i)}
          onReview={(on) => onReview(pr, on)}
        />
      ))}
    </div>
  );
}
