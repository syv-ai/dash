import type * as React from 'react';
import {
  Settings,
  Archive,
  Trash2,
  AtSign,
  Brain,
  ScrollText,
  RotateCw,
  Star,
  FolderOpen,
  GitBranch,
  Link2,
} from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu';
import { IdeIcon } from '../ui/IdeIcon';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { copyTaskMessageAddress } from '../../utils/copyMessageAddress';
import { useProjects, selectTaskById } from '../../stores/projectsStore';
import { useUi } from '../../stores/uiStore';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { useSetup } from '../../stores/setupStore';
import { favoriteLabel } from './FavoriteButton';
import { copyText, revealLabel } from '../diffEditor/fileActions';

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
  const setupRun = useSetup((s) => (task ? s.runs[task.path] : undefined));
  const showSetup = useSetup((s) => s.showSetup);
  const rerunSetup = useSetup((s) => s.rerun);
  const openTaskMemory = useUi((s) => s.openTaskMemory);
  const setFavorite = useProjects((s) => s.setFavorite);
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
          <Item onSelect={() => copyText(task.branch, 'branch')}>
            <GitBranch size={13} strokeWidth={1.8} />
            Copy branch
          </Item>
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
      {task?.useWorktree && setupRun && (
        <Item onSelect={() => showSetup(task.path)}>
          <ScrollText size={13} strokeWidth={1.8} />
          Setup output
        </Item>
      )}
      {task?.useWorktree && (
        <Item disabled={setupRun?.status === 'running'} onSelect={() => void rerunSetup(task)}>
          <RotateCw size={13} strokeWidth={1.8} />
          {setupRun ? 'Run setup again' : 'Run setup'}
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
        <Item onSelect={() => openTaskMemory(task.projectId, taskId)}>
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
