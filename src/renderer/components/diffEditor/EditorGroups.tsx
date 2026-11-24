import { Fragment, useCallback, useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { FileText } from 'lucide-react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/Resizable';
import { EmptyState } from '../ui/EmptyState';
import { sheetSurface } from '../ui/FolderTab';
import { cn } from '../../lib/cn';
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
import { addCloseGuard } from './closeGuard';
import { absolutePath } from './editor/fileRef';
import { LspStatusIndicator } from './LspStatusIndicator';
import { installLsp } from '../../lsp';

interface Props {
  ws: EditorWorkspace;
  terminalTheme: XtermTheme;
  isDark: boolean;
  /** Close the editor. The host's close asks `mayCloseEditor()` first. */
  onClose: () => void;
}

function useDirtyVersion(): number {
  return useSyncExternalStore(subscribeDirty, dirtyVersion);
}

/**
 * The editor's groups: one, or two side by side (resizable), each a stack of
 * case files — a tab strip on the chrome whose active tab opens into the sheet
 * below it, the pane showing that file. The host gives them the chrome to sit
 * on; each group draws its own sheet. The panes keep one Monaco widget each
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

  // Every way of closing the editor lives with its host; each asks here first.
  // Once the discard is agreed, a second ask in the same close passes.
  useEffect(() => {
    let agreed = false;
    return addCloseGuard(() => {
      if (agreed || !anyDirtyUnder(cwd)) return true;
      agreed = window.confirm('Discard unsaved changes?');
      return agreed;
    });
  }, [cwd]);

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
    <div
      className="h-full min-h-0"
      style={{ '--sheet-bg': terminalTheme.background } as CSSProperties}
      onKeyDown={onKeyDown}
    >
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
                  // The second stack keeps the sheets' 8px gutter from the first.
                  className={cn('flex h-full min-w-0 flex-col', i > 0 && 'pl-2')}
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
                    trailing={isLast && ws.git ? <LspStatusIndicator worktree={cwd} /> : null}
                  />
                  <div
                    className={cn(
                      'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line',
                      sheetSurface,
                    )}
                  >
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
                        onClose={onClose}
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
                </div>
              </ResizablePanel>
            </Fragment>
          );
        })}
      </ResizablePanelGroup>
    </div>
  );
}
