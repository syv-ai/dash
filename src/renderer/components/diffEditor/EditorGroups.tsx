import { Fragment, useCallback, useEffect, useSyncExternalStore } from 'react';
import { FileText } from 'lucide-react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/Resizable';
import { EmptyState } from '../ui/EmptyState';
import { useEditorTabs } from '../../stores/editorTabsStore';
import { useSettings } from '../../stores/settingsStore';
import { matchesBinding } from '../../keybindings';
import { EditorPane } from './EditorPane';
import { EditorTabStrip } from './EditorTabStrip';
import type { EditorWorkspace } from './useEditorWorkspace';
import { openPaths, type GroupIndex } from './tabs/editorLayout';
import {
  anyDirtyUnder,
  dirtyVersion,
  isDirty,
  releaseRetained,
  retain,
  subscribeDirty,
  workingUri,
} from './models';
import { TreeToggle } from './TreeToggle';
import { absolutePath } from './editor/fileRef';
import { LspStatusIndicator } from './LspStatusIndicator';
import { installLsp } from '../../lsp';

interface Props {
  ws: EditorWorkspace;
  terminalTheme: XtermTheme;
  isDark: boolean;
  /** Close the editor (asks first when a file has unsaved changes). */
  onClose: () => void;
}

function useDirtyVersion(): number {
  return useSyncExternalStore(subscribeDirty, dirtyVersion);
}

/**
 * The editor's groups: one, or two side by side (resizable), each a tab strip
 * over a pane showing its active file. The panes keep one Monaco widget each
 * and swap models as tabs change; files open in a tab stay loaded (unsaved
 * edits included) until their last tab closes.
 */
export function EditorGroups({ ws, terminalTheme, isDark, onClose }: Props) {
  const { layout, tabsKey, cwd } = ws;
  const closeBinding = useSettings((s) => s.keybindings.closeEditorTab);
  useEffect(installLsp, []);

  // Every open tab's working file stays alive, shown or not.
  const holder = `tabs:${tabsKey}`;
  useEffect(() => {
    retain(
      holder,
      openPaths(layout).map((p) => absolutePath(cwd, p)),
    );
  }, [holder, layout, cwd]);
  useEffect(() => () => releaseRetained(holder), [holder]);

  // Editing a preview tab keeps it.
  const dirtyTick = useDirtyVersion();
  useEffect(() => {
    layout.groups.forEach((g, i) => {
      if (g.preview && isDirty(workingUri(absolutePath(cwd, g.preview)))) {
        ws.pinTab(i as GroupIndex, g.preview);
      }
    });
  }, [dirtyTick, layout, cwd, ws]);

  // A tab naming a folder (from before it was one): close it and show the
  // folder in the tree instead.
  const { closeTab: wsCloseTab } = ws;
  const showFolder = useCallback(
    (group: GroupIndex, path: string) => {
      wsCloseTab(group, path);
      useEditorTabs.getState().requestExpandFolder(path);
    },
    [wsCloseTab],
  );

  const closeEditor = useCallback(() => {
    if (anyDirtyUnder(cwd) && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }, [cwd, onClose]);

  // Closing a file's last tab drops its unsaved edits: ask first.
  const closeTab = (group: GroupIndex, path: string) => {
    const lastTab = layout.groups.filter((g) => g.tabs.includes(path)).length === 1;
    const dirty = isDirty(workingUri(absolutePath(cwd, path)));
    if (lastTab && dirty && !window.confirm(`Discard unsaved changes to ${path}?`)) return;
    ws.closeTab(group, path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!closeBinding || e.defaultPrevented || !matchesBinding(e.nativeEvent, closeBinding)) return;
    const active = layout.groups[layout.focused]?.active;
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    closeTab(layout.focused, active);
  };

  const reveal = useEditorTabs((s) => (s.reveal?.key === tabsKey ? s.reveal : null));
  const clearReveal = useCallback((n: number) => useEditorTabs.getState().clearReveal(n), []);
  const split = layout.groups.length > 1;

  return (
    <div className="h-full min-h-0" onKeyDown={onKeyDown}>
      <ResizablePanelGroup
        orientation="horizontal"
        autoSaveId="editor-groups"
        panelIds={split ? ['group-0', 'group-1'] : ['group-0']}
      >
        {layout.groups.map((group, i) => {
          const index = i as GroupIndex;
          const isLast = i === layout.groups.length - 1;
          const groupReveal =
            reveal && reveal.group === index && reveal.path === group.active
              ? { range: reveal.range, nonce: reveal.nonce }
              : null;
          return (
            <Fragment key={i}>
              {i > 0 && <ResizableHandle />}
              <ResizablePanel id={`group-${i}`} minSize="20%">
                <div
                  className="flex h-full min-w-0 flex-col"
                  // Clicking or tabbing into a group makes it the one "open" targets.
                  onPointerDownCapture={() => ws.focusGroup(index)}
                  onFocusCapture={() => ws.focusGroup(index)}
                >
                  <EditorTabStrip
                    cwd={cwd}
                    tabs={group.tabs}
                    active={group.active}
                    preview={group.preview}
                    focused={!split || layout.focused === index}
                    onSelect={(path) => ws.activateTab(index, path)}
                    onClose={(path) => closeTab(index, path)}
                    onPin={(path) => ws.pinTab(index, path)}
                    leading={i === 0 ? <TreeToggle /> : undefined}
                    onSplit={
                      group.active ? () => ws.openFile(group.active!, { toSide: true }) : undefined
                    }
                    onCloseEditor={isLast ? closeEditor : undefined}
                    trailing={isLast && ws.git ? <LspStatusIndicator worktree={cwd} /> : null}
                  />
                  {group.active ? (
                    <EditorPane
                      paneId={`pane:${tabsKey}:${i}`}
                      cwd={cwd}
                      git={ws.git}
                      filePath={group.active}
                      view={ws.view}
                      activeTaskId={ws.activeTaskId}
                      terminalTheme={terminalTheme}
                      isDark={isDark}
                      revealCommentId={ws.revealCommentId}
                      onNavigateToComment={ws.navigateToComment}
                      onClearReveal={ws.clearRevealComment}
                      onClose={closeEditor}
                      onSelectBase={ws.selectBase}
                      onExitBranchView={ws.exitBranchView}
                      defaultBase={ws.data.defaultBase}
                      projectId={ws.projectId}
                      onSelectPr={ws.openPrView}
                      onSelectFile={ws.openFile}
                      revealRange={groupReveal}
                      onRevealed={clearReveal}
                      onIsDirectory={(path) => showFolder(index, path)}
                    />
                  ) : (
                    <EmptyState
                      icon={<FileText size={14} strokeWidth={1.8} />}
                      title="Open a file from the tree"
                    />
                  )}
                </div>
              </ResizablePanel>
            </Fragment>
          );
        })}
      </ResizablePanelGroup>
    </div>
  );
}
