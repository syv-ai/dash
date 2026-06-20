import { Code2, Power, Settings, Archive, Trash2 } from 'lucide-react';
import { IconButton } from '../ui/IconButton';

interface TaskActionsProps {
  /** Show the Close (power) button only when the task has a live session. */
  hasActiveSession: boolean;
  onOpenIde: () => void;
  onClose: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/**
 * The shared task-card action toolbar — rendered identically in the left-sidebar
 * TaskCard and the ProjectOverview cards. Each button stops propagation so it
 * never triggers the card's own select handler. Parents own the positioning and
 * hover-reveal; this renders just the button row.
 */
export function TaskActions({
  hasActiveSession,
  onOpenIde,
  onClose,
  onSettings,
  onArchive,
  onDelete,
}: TaskActionsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onOpenIde();
        }}
        title="Open in IDE"
        size="sm"
      >
        <Code2 size={12} strokeWidth={1.8} />
      </IconButton>
      {hasActiveSession && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close task"
          size="sm"
        >
          <Power size={12} strokeWidth={1.8} />
        </IconButton>
      )}
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onSettings();
        }}
        title="Task settings"
        size="sm"
      >
        <Settings size={12} strokeWidth={1.8} />
      </IconButton>
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
        title="Archive task"
        size="sm"
      >
        <Archive size={12} strokeWidth={1.8} />
      </IconButton>
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete task"
        variant="destructive"
        size="sm"
      >
        <Trash2 size={12} strokeWidth={1.8} />
      </IconButton>
    </div>
  );
}
