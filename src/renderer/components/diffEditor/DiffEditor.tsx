import { useState, type CSSProperties } from 'react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/Resizable';
import type { EditorView } from './types';
import { EditorTree } from './EditorTree';
import { EditorGroups } from './EditorGroups';
import { useEditorWorkspace, type EditorTarget } from './useEditorWorkspace';
import { activePath } from './tabs/editorLayout';

export interface DiffEditorProps {
  cwd: string;
  /** The file to open, or '' for none. */
  initialFilePath: string;
  /** The view to open in; absent: the folder's last view. */
  initialView?: EditorView;
  activeTaskId: string | null;
  /** The project `cwd` belongs to; PR review calls name it. */
  projectId: string | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  onClose: () => void;
}

/** The editor for a folder that isn't the active task's worktree (Claude's
 *  memory, in <DiffEditorModal>): its file tree beside its tabs and groups.
 *  The tabs last as long as the window, not across restarts. A task's own
 *  editor lives in the task sidebar (RightInspector). */
export function DiffEditor({
  cwd,
  initialFilePath,
  initialView,
  activeTaskId,
  projectId,
  terminalTheme,
  isDark,
  onClose,
}: DiffEditorProps) {
  const [target] = useState<EditorTarget>(() => ({ filePath: initialFilePath, initialView }));
  const ws = useEditorWorkspace({
    tabsKey: `folder:${cwd}`,
    persistTabs: false,
    cwd,
    openTaskId: activeTaskId,
    projectId,
    editorOpen: true,
    historyShown: false,
    target,
  });
  const bg = terminalTheme.background;

  return (
    <div
      className={`h-full w-full overflow-hidden ${bg ? 'bg-(--sheet-bg)' : 'bg-well'}`}
      style={{ '--sheet-bg': bg } as CSSProperties}
    >
      <ResizablePanelGroup orientation="horizontal" autoSaveId="diff-editor-shell">
        {/* pr-3 keeps the 12px gutter the old handle took up. */}
        <ResizablePanel id="sidebar" defaultSize="22%" minSize="14%" maxSize="45%" className="pr-3">
          <EditorTree
            cwd={cwd}
            git={ws.git}
            view={ws.view}
            allPaths={ws.data.repoPaths}
            changedFiles={ws.data.changedFiles}
            changedOnly={false}
            filesLoading={ws.data.repoPathsLoading || ws.data.changedFilesLoading}
            selectedPath={activePath(ws.layout) ?? ''}
            onOpenFile={ws.openFile}
            badgeCounts={ws.badgeCounts}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="editor" minSize="40%">
          <EditorGroups ws={ws} terminalTheme={terminalTheme} isDark={isDark} onClose={onClose} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
