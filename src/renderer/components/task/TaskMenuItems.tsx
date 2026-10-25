import { Settings, Archive, Trash2, AtSign } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu';
import { IdeIcon } from '../ui/IdeIcon';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { copyTaskMessageAddress } from '../../utils/copyMessageAddress';
import { useProjects } from '../../stores/projectsStore';
import { sessionRegistry } from '../../terminal/SessionRegistry';

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
