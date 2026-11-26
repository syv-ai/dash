import { LetterM } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { Badge } from './Badge';
import { useTaskBranch } from '../../stores/gitStore';
import type { Task } from '../../../shared/types';

interface MainRepoBadgeProps {
  /** The task; its live branch goes in the tooltip. */
  task: Pick<Task, 'id' | 'branch'>;
}

/**
 * Marks a task that runs in the project's own checkout rather than a worktree:
 * an M (for main) in the changed-file gold, the one colour beside the task
 * name that isn't agent state (M2).
 */
export function MainRepoBadge({ task }: MainRepoBadgeProps) {
  const branch = useTaskBranch(task);
  const where = branch ? ` on ${branch}` : '';
  return (
    <Tooltip content={`Runs in the project's own checkout${where}, not a worktree`}>
      <Badge tone="changed" size="icon-sm" aria-label="Runs in the project's own checkout">
        <LetterM size={11} strokeWidth={1.8} />
      </Badge>
    </Tooltip>
  );
}
