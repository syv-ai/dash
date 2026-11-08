import { Settings, Archive, Trash2, AtSign, ScrollText, RotateCw } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu';
import { IdeIcon } from '../ui/IdeIcon';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { copyTaskMessageAddress } from '../../utils/copyMessageAddress';
import { useProjects } from '../../stores/projectsStore';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { useSetup } from '../../stores/setupStore';

let focusTerminalOnClose = false;

/**
 * Every task "…" menu's onCloseAutoFocus. After an item that leaves the user
 * where they were (copying the address), focus goes back to the active task's
 * Claude Code prompt instead of the "…" button.
 */
export function onTaskMenuCloseAutoFocus(e: Event) {
  if (!focusTerminalOnClose) return;
  focusTerminalOnClose = false;
  const id = useProjects.getState().activeTaskId;
  const session = id ? sessionRegistry.get(id) : undefined;
  if (!session) return;
  e.preventDefault();
  session.focus();
}

export interface TaskMenuHandlers {
  taskId: string;
  onOpenIde: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/**
 * The items every task "…" menu shows: the task cards' menu and the task
 * header's. Both render this list, so the two can't drift apart; a menu adds
 * its own extras around it.
 */
export function TaskMenuItems({
  taskId,
  onOpenIde,
  onSettings,
  onArchive,
  onDelete,
}: TaskMenuHandlers) {
  const { ideId, openLabel } = usePreferredIde();
  const task = useProjects((s) => {
    for (const list of Object.values(s.tasksByProject)) {
      const t = list.find((x) => x.id === taskId);
      if (t) return t;
    }
    return null;
  });
  const setupRun = useSetup((s) => (task ? s.runs[task.path] : undefined));
  const openSetupLog = useSetup((s) => s.openLog);
  const rerunSetup = useSetup((s) => s.rerun);
  return (
    <>
      <DropdownMenuItem onSelect={onOpenIde}>
        <span className="inline-flex w-[13px] justify-center text-muted-foreground">
          <IdeIcon ideId={ideId} />
        </span>
        {openLabel}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onSettings}>
        <Settings size={13} strokeWidth={1.8} className="text-muted-foreground" />
        Task settings
      </DropdownMenuItem>
      {task?.useWorktree && setupRun && (
        <DropdownMenuItem onSelect={() => void openSetupLog(task.path)}>
          <ScrollText size={13} strokeWidth={1.8} className="text-muted-foreground" />
          Setup output
        </DropdownMenuItem>
      )}
      {task?.useWorktree && (
        <DropdownMenuItem
          disabled={setupRun?.status === 'running'}
          onSelect={() => void rerunSetup(task)}
        >
          <RotateCw size={13} strokeWidth={1.8} className="text-muted-foreground" />
          {setupRun ? 'Run setup again' : 'Run setup'}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onSelect={() => {
          focusTerminalOnClose = true;
          void copyTaskMessageAddress(taskId);
        }}
      >
        <AtSign size={13} strokeWidth={1.8} className="text-muted-foreground" />
        Copy message address
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onArchive}>
        <Archive size={13} strokeWidth={1.8} className="text-muted-foreground" />
        Archive
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={onDelete}
        className="text-destructive focus:bg-destructive/10 data-highlighted:bg-destructive/10"
      >
        <Trash2 size={13} strokeWidth={1.8} />
        Delete
      </DropdownMenuItem>
    </>
  );
}
