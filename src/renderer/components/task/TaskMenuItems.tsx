import type * as React from 'react';
import {
  Settings,
  Archive,
  Trash2,
  AtSign,
  Brain,
  Star,
  FolderOpen,
  GitBranch,
  Link2,
  Flame,
} from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu';
import { IdeIcon } from '../ui/IdeIcon';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { copyTaskMessageAddress } from '../../utils/copyMessageAddress';
import { useProjects, selectProjectHasGit, selectTaskById } from '../../stores/projectsStore';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { copyText, revealLabel } from '../diffEditor/fileActions';
import { showTaskMemory } from '../memory/showMemory';
import { changeSessionSetting, useBypassAvailability } from './changeSessionSetting';

/** What the favourite toggle says. */
const favoriteLabel = (favorite: boolean) =>
  favorite ? 'Remove from favourites' : 'Add to favourites';

let focusTerminalOnClose = false;

/**
 * Every task menu's onCloseAutoFocus. After an item that leaves the user
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

/** The item and separator of the menu the items render in: a dropdown (the
 *  default) or a right-click ContextMenu. Both are Radix menus with one API. */
export interface MenuParts {
  Item: React.ComponentType<{
    onSelect?: (e: Event) => void;
    disabled?: boolean;
    variant?: 'default' | 'destructive';
    children?: React.ReactNode;
  }>;
  Separator: React.ComponentType;
}

const DROPDOWN_PARTS: MenuParts = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator };

export interface TaskMenuHandlers {
  taskId: string;
  onOpenIde: () => void;
  onSettings: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Defaults to the dropdown's. */
  parts?: MenuParts;
}

/**
 * The items every task menu shows, in groups (favourite; open, reveal and
 * copy; the task's own settings and tools; archive; delete last): the task
 * cards' "…" menu, the task header's, and both task lists' right-click menu. All render this list, so
 * they can't drift apart; a menu adds its own extras around it.
 */
export function TaskMenuItems({
  taskId,
  onOpenIde,
  onSettings,
  onArchive,
  onDelete,
  parts = DROPDOWN_PARTS,
}: TaskMenuHandlers) {
  const { Item, Separator } = parts;
  const { ideId, openLabel } = usePreferredIde();
  const task = useProjects((s) => selectTaskById(s, taskId));
  const setFavorite = useProjects((s) => s.setFavorite);
  const hasGit = useProjects((s) => selectProjectHasGit(s, task?.projectId));
  // Read as the menu opens. While unknown, or when a setting turns it off,
  // the item stays out: Task settings shows it off with the reason.
  const bypass = useBypassAvailability(task?.path);
  const canSwitchToYolo =
    !!task && task.permissionMode !== 'bypassPermissions' && !!bypass?.available;
  return (
    <>
      {task && (
        <>
          <Item onSelect={() => void setFavorite(task, !task.favorite)}>
            <Star size={13} strokeWidth={1.8} />
            {favoriteLabel(task.favorite)}
          </Item>
          <Separator />
        </>
      )}
      <Item onSelect={onOpenIde}>
        <span className="inline-flex w-3.25 justify-center text-icon">
          <IdeIcon ideId={ideId} />
        </span>
        {openLabel}
      </Item>
      {task && (
        <>
          <Item onSelect={() => window.electronAPI.showItemInFolder(task.path)}>
            <FolderOpen size={13} strokeWidth={1.8} />
            {revealLabel()}
          </Item>
          {hasGit && (
            <Item onSelect={() => copyText(task.branch, 'branch')}>
              <GitBranch size={13} strokeWidth={1.8} />
              Copy branch
            </Item>
          )}
          <Item onSelect={() => copyText(task.path, 'path')}>
            <Link2 size={13} strokeWidth={1.8} />
            Copy path
          </Item>
        </>
      )}
      <Separator />
      <Item onSelect={onSettings}>
        <Settings size={13} strokeWidth={1.8} />
        Task settings
      </Item>
      {canSwitchToYolo && (
        <Item
          onSelect={() =>
            void changeSessionSetting(task, { setting: 'permissionMode', to: 'bypassPermissions' })
          }
        >
          <Flame size={13} strokeWidth={1.8} />
          Switch to Yolo…
        </Item>
      )}
      <Item
        onSelect={() => {
          focusTerminalOnClose = true;
          void copyTaskMessageAddress(taskId);
        }}
      >
        <AtSign size={13} strokeWidth={1.8} />
        Copy message address
      </Item>
      {task && (
        <Item onSelect={() => showTaskMemory(taskId)}>
          <Brain size={13} strokeWidth={1.8} />
          Memories
        </Item>
      )}
      <Separator />
      <Item onSelect={onArchive}>
        <Archive size={13} strokeWidth={1.8} />
        Archive
      </Item>
      <Separator />
      <Item onSelect={onDelete} variant="destructive">
        <Trash2 size={13} strokeWidth={1.8} />
        Delete
      </Item>
    </>
  );
}
