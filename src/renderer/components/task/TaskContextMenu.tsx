import type * as React from 'react';
import { Power } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import { useRuntime } from '../../stores/runtimeStore';
import { hasLiveSession } from './TaskActions';
import { TaskMenuItems, onTaskMenuCloseAutoFocus, type MenuParts } from './TaskMenuItems';

const CONTEXT_PARTS: MenuParts = { Item: ContextMenuItem, Separator: ContextMenuSeparator };

/**
 * A task row's right-click menu (both sidebar views): "Put to sleep" while
 * the session is live, then every task menu's items (`TaskMenuItems`).
 * `children` is the row; it takes the trigger's props and ref.
 */
export function TaskContextMenu({
  taskId,
  onOpenIde,
  onSleep,
  onSettings,
  onArchive,
  onDelete,
  children,
}: {
  taskId: string;
  onOpenIde: () => void;
  onSleep: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onDelete: () => void;
  children: React.ReactElement;
}) {
  const activityState = useRuntime((s) => s.taskActivity[taskId]?.state);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={onTaskMenuCloseAutoFocus}>
        {/* Grouped with the favourite toggle that leads TaskMenuItems. */}
        {hasLiveSession(activityState) && (
          <ContextMenuItem onSelect={onSleep}>
            <Power size={13} strokeWidth={1.8} />
            Put to sleep
          </ContextMenuItem>
        )}
        <TaskMenuItems
          taskId={taskId}
          parts={CONTEXT_PARTS}
          onOpenIde={onOpenIde}
          onSettings={onSettings}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
