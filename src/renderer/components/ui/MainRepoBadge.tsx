import { LetterM, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Tooltip } from './Tooltip';
import { Badge } from './Badge';
import { useTaskBranch } from '../../stores/gitStore';
import { selectProjectHasGit, useProjects } from '../../stores/projectsStore';
import { folderSharers } from '../../../shared/folderSharing';
import { sharedFolderTooltip } from '../task/sharedFolder';
import type { Task } from '../../../shared/types';

interface MainRepoBadgeProps {
  /** The task; its live branch goes in the tooltip. */
  task: Pick<Task, 'id' | 'branch' | 'projectId' | 'path' | 'useWorktree'>;
}

/**
 * Marks a task that runs in the project's own folder rather than a worktree.
 * In a repository, an M (for main) in the changed-file gold, the one colour
 * beside the task name that isn't agent state (M2). A plain folder has no
 * worktrees to tell it from, so every task runs there and gets no M; the
 * mark there is a quiet one in the badge's bare ink when other active tasks
 * share the folder (folderSharing), whose edits can collide with its own.
 */
export function MainRepoBadge({ task }: MainRepoBadgeProps) {
  const branch = useTaskBranch(task);
  const hasGit = useProjects((s) => selectProjectHasGit(s, task.projectId));
  const sharers = useProjects(
    useShallow((s) =>
      folderSharers(task, s.tasksByProject[task.projectId] ?? []).map((t) => t.name),
    ),
  );
  const shared = sharedFolderTooltip(sharers);
  const where = branch ? ` on ${branch}` : '';
  return (
    <>
      {hasGit && (
        <Tooltip content={`Runs in the project's own checkout${where}, not a worktree`}>
          <Badge tone="changed" size="icon-sm" aria-label="Runs in the project's own checkout">
            <LetterM size={11} strokeWidth={1.8} />
          </Badge>
        </Tooltip>
      )}
      {shared && (
        <Tooltip content={shared}>
          <Badge tone="bare" size="icon-sm" aria-label={shared}>
            <Users size={11} strokeWidth={1.8} />
          </Badge>
        </Tooltip>
      )}
    </>
  );
}
