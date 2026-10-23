import { Settings, Archive, Trash2 } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu';
import { IdeIcon } from '../ui/IdeIcon';
import { usePreferredIde } from '../../hooks/usePreferredIde';

export interface TaskMenuHandlers {
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
export function TaskMenuItems({ onOpenIde, onSettings, onArchive, onDelete }: TaskMenuHandlers) {
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
