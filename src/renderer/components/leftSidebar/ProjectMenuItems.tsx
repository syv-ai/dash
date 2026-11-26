import { Archive, Brain, FolderOpen, GitGraph, Link2, Plus, Settings, Trash2 } from 'lucide-react';
import type { Project } from '../../../shared/types';
import { IdeIcon } from '../ui/IdeIcon';
import type { MenuParts } from '../task/TaskMenuItems';
import { copyText, revealLabel } from '../diffEditor/fileActions';
import { usePreferredIde } from '../../hooks/usePreferredIde';
import { openInIde } from '../../lib/openInIde';

export interface ProjectMenuHandlers {
  project: Project;
  parts: MenuParts;
  /** Leads the menu when given (the right-click menu; the row's hover has
   *  its own + beside the "…" menu). */
  onNewTask?: () => void;
  onShowCommitGraph: () => void;
  onSettings: () => void;
  onOpenMemory: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/**
 * A project row's menu items, for its "…" dropdown and its right-click menu
 * alike, in groups: new task; open, reveal and copy; the project's views and
 * settings; archive; delete last (it confirms).
 */
export function ProjectMenuItems({
  project,
  parts: { Item, Separator },
  onNewTask,
  onShowCommitGraph,
  onSettings,
  onOpenMemory,
  onArchive,
  onDelete,
}: ProjectMenuHandlers) {
  const { ideId, openLabel } = usePreferredIde();
  return (
    <>
      {onNewTask && (
        <>
          <Item onSelect={onNewTask}>
            <Plus size={13} strokeWidth={1.8} />
            New task
          </Item>
          <Separator />
        </>
      )}
      <Item onSelect={() => void openInIde(project.path)}>
        <span className="inline-flex w-3.25 justify-center text-icon">
          <IdeIcon ideId={ideId} />
        </span>
        {openLabel}
      </Item>
      <Item onSelect={() => window.electronAPI.showItemInFolder(project.path)}>
        <FolderOpen size={13} strokeWidth={1.8} />
        {revealLabel()}
      </Item>
      <Item onSelect={() => copyText(project.path, 'path')}>
        <Link2 size={13} strokeWidth={1.8} />
        Copy path
      </Item>
      <Separator />
      <Item onSelect={onShowCommitGraph}>
        <GitGraph size={13} strokeWidth={1.8} />
        Commit graph
      </Item>
      <Item onSelect={onSettings}>
        <Settings size={13} strokeWidth={1.8} />
        Project settings
      </Item>
      <Item onSelect={onOpenMemory}>
        <Brain size={13} strokeWidth={1.8} />
        Claude memory
      </Item>
      <Separator />
      <Item onSelect={onArchive}>
        <Archive size={13} strokeWidth={1.8} />
        Archive project
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={onDelete}>
        <Trash2 size={13} strokeWidth={1.8} />
        Delete project
      </Item>
    </>
  );
}
