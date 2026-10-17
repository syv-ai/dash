import { Tooltip } from './Tooltip';
import { useTaskBranch } from '../../stores/gitStore';
import type { Task } from '../../../shared/types';

interface MainRepoBadgeProps {
  /** The task; its live branch goes in the tooltip. */
  task: Pick<Task, 'id' | 'branch'>;
}

/**
 * Marks a task that runs in the project's own checkout rather than a worktree.
 * Borderless and deliberately quiet: a translucent tint of the deep-blue
 * badge token carries the meaning, with muted text so it reads as metadata
 * next to the task name rather than competing with it, in every theme.
 */
export function MainRepoBadge({ task }: MainRepoBadgeProps) {
  const branch = useTaskBranch(task);
  const where = branch ? ` on ${branch}` : '';
  return (
    <Tooltip content={`Runs in the project's own checkout${where}, not a worktree`}>
      <span className="inline-flex items-center rounded-full bg-[hsl(var(--badge-main)/0.3)] text-muted-foreground text-[9px] font-medium leading-none px-1.5 py-[3px] shrink-0 select-none">
        main
      </span>
    </Tooltip>
  );
}
