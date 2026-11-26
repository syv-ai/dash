import { CircleLetterM } from 'lucide-react';
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
 * a teal circled M (for main), the one colour beside the task name that
 * isn't agent state (M1).
 */
export function MainRepoBadge({ task }: MainRepoBadgeProps) {
  const branch = useTaskBranch(task);
  const where = branch ? ` on ${branch}` : '';
  return (
    <Tooltip content={`Runs in the project's own checkout${where}, not a worktree`}>
      <Badge tone="checkout" size="icon" aria-label="Runs in the project's own checkout">
        <CircleLetterM size={14} strokeWidth={1.8} />
      </Badge>
    </Tooltip>
  );
}
