import { Power, MoreHorizontal } from 'lucide-react';
import type { ActivityState } from '../../../shared/types';
import { IconButton } from '../ui/IconButton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/DropdownMenu';
import { TaskMenuItems } from './TaskMenuItems';

interface TaskActionsProps {
  /** The task's activity state; the "Put to sleep" (power) button shows only
   *  while there is a live session — not for a task with none, nor for one
   *  already sleeping (`stopped`), where the button would be a no-op. */
  activityState?: ActivityState;
  onOpenIde: () => void;
  onClose: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Fires when the "…" menu opens or closes, so a hover-revealed parent can
   *  stay visible while the menu is up even though the pointer has left. */
  onMenuOpenChange?: (open: boolean) => void;
}

/**
 * The shared task-card action toolbar — rendered identically in the left-sidebar
 * TaskCard and the ProjectOverview cards: the one-click "Put to sleep" button
 * plus a "…" menu for the rest (IDE, settings, archive, delete). Every control
 * stops propagation so it never triggers the card's own select handler.
 * Parents own the positioning and hover-reveal; this renders just the row.
 */
/** A session the power button can put to sleep: present and not already asleep. */
export function hasLiveSession(state: ActivityState | undefined): boolean {
  return !!state && state !== 'stopped';
}

export function TaskActions({
  activityState,
  onOpenIde,
  onClose,
  onSettings,
  onArchive,
  onDelete,
  onMenuOpenChange,
}: TaskActionsProps) {
  return (
    <div className="flex items-center gap-0.5">
      {hasLiveSession(activityState) && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Put to sleep"
          size="sm"
        >
          <Power size={12} strokeWidth={1.8} />
        </IconButton>
      )}
      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <IconButton onClick={(e) => e.stopPropagation()} title="More actions" size="sm">
            <MoreHorizontal size={12} strokeWidth={1.8} />
          </IconButton>
        </DropdownMenuTrigger>
        {/* Items render in a portal, but React events still bubble through the
            tree to the card's onClick — stop them here. */}
        <DropdownMenuContent align="end" className="min-w-36" onClick={(e) => e.stopPropagation()}>
          <TaskMenuItems
            onOpenIde={onOpenIde}
            onSettings={onSettings}
            onArchive={onArchive}
            onDelete={onDelete}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
