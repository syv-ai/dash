import { House } from 'lucide-react';
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
 * a quiet house icon, muted so it reads as metadata beside the task name.
 */
export function MainRepoBadge({ task }: MainRepoBadgeProps) {
  const branch = useTaskBranch(task);
  const where = branch ? ` on ${branch}` : '';
  return (
    <Tooltip content={`Runs in the project's own checkout${where}, not a worktree`}>
      <Badge tone="bare" size="icon" aria-label="Runs in the project's own checkout">
        <House size={14} strokeWidth={1.8} />
      </Badge>
    </Tooltip>
  );
}
