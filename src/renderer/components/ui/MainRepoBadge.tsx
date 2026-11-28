import { LetterM } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { Badge } from './Badge';
import { useTaskBranch } from '../../stores/gitStore';
import { selectProjectHasGit, useProjects } from '../../stores/projectsStore';
import type { Task } from '../../../shared/types';

interface MainRepoBadgeProps {
  /** The task; its live branch goes in the tooltip. */
  task: Pick<Task, 'id' | 'branch' | 'projectId'>;
}

/**
 * Marks a task that runs in the project's own checkout rather than a worktree:
 * an M (for main) in the changed-file gold, the one colour beside the task
 * name that isn't agent state (M2). None for a plain folder's task: with no
 * worktrees to tell it from, every task runs in the folder.
 */
export function MainRepoBadge({ task }: MainRepoBadgeProps) {
  const branch = useTaskBranch(task);
  const hasGit = useProjects((s) => selectProjectHasGit(s, task.projectId));
  if (!hasGit) return null;
  const where = branch ? ` on ${branch}` : '';
  return (
    <Tooltip content={`Runs in the project's own checkout${where}, not a worktree`}>
      <Badge tone="changed" size="icon-sm" aria-label="Runs in the project's own checkout">
        <LetterM size={11} strokeWidth={1.8} />
      </Badge>
    </Tooltip>
  );
}
