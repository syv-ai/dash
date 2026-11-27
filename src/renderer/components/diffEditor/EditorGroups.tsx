import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { FileText } from 'lucide-react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../ui/Resizable';
import { EmptyState } from '../ui/EmptyState';
import { folderSheet } from '../ui/FolderTab';
import { stepTab, useWheelTabSwitch, type ScrollProbe } from '../ui/useWheelTabSwitch';
import { cn } from '../../lib/cn';
import { selectLayout, useEditorTabs, type TextRange } from '../../stores/editorTabsStore';
import { useEditors } from '../../stores/editorsStore';
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
import { park, retainedOnUnmount, unpark } from './retention';
import { TreeToggle } from './TreeToggle';
import { addCloseGuard } from './closeGuard';
import { confirm } from '../ui/ConfirmHost';
import { absolutePath, isOutsideWorktree } from './editor/fileRef';
import type { EditorView } from './types';
import { LspStatusIndicator } from './LspStatusIndicator';
import { useReviewNavigation } from './prReview/useReviewNavigation';
import { installLsp } from '../../lsp';

interface Props {
  ws: EditorWorkspace;
  terminalTheme: XtermTheme;
  isDark: boolean;
  /** The host's editor-wide actions (closing the editor), at the editor's
   *  top-right corner. */
  actions?: ReactNode;
}

/** The view a plain file (outside the worktree) shows in: as it is on disk. */
const PLAIN_VIEW: EditorView = { kind: 'working', ref: 'HEAD' };

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
export function EditorGroups({ ws, terminalTheme, isDark, actions }: Props) {
  const { layout, tabsKey, cwd } = ws;
  const closeBinding = useSettings((s) => s.keybindings.closeEditorTab);
  useEffect(installLsp, []);

  // Every open file tab's working file stays alive, shown or not.
  const holder = `tabs:${tabsKey}`;
  useEffect(() => unpark(holder), [holder]);
  useEffect(() => {
    retain(
      holder,
      openPaths(layout).map((p) => absolutePath(cwd, p)),
    );
  }, [holder, layout, cwd]);
  // Unmounted while still open (its task switched away from), the unsaved
  // ones stay, until switching back finds them or the editor closes (its
  // task archived or deleted meanwhile). Closed, none do.
  useEffect(
    () => () => {
      const files = openPaths(selectLayout(tabsKey)(useEditorTabs.getState())).map((p) =>
        absolutePath(cwd, p),
      );
      const closed = !useEditors.getState().byCwd[cwd];
      const kept = retainedOnUnmount(files, closed, (f) => isDirty(workingUri(f)));
      retain(holder, kept);
      if (kept.length > 0) park(holder, cwd, releaseRetained);
    },
    [holder, tabsKey, cwd],
  );

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
    return addCloseGuard(cwd, async () => {
      // The worktree's files, and the tabs' files outside it (A10).
      const outside = openPaths(selectLayout(tabsKey)(useEditorTabs.getState())).filter(
        (p) => isOutsideWorktree(p) && isDirty(workingUri(p)),
      );
      if (agreed || (!anyDirtyUnder(cwd) && outside.length === 0)) return true;
      agreed = await confirm({
        message: 'Discard unsaved changes?',
        confirmLabel: 'Discard',
        destructive: true,
      });
      return agreed;
    });
  }, [cwd, tabsKey]);

  // Closing a file's last tab drops its unsaved edits: ask first, once for
  // every such file among `paths`.
  const closeTabs = async (group: GroupIndex, paths: string[]) => {
    const other = layout.groups.find((_, i) => i !== group);
    const losing = paths.filter(
      (p) => !other?.tabs.includes(p) && isDirty(workingUri(absolutePath(cwd, p))),
    );
    if (losing.length > 0) {
      const discard = await confirm({
        message:
          losing.length === 1
            ? `Discard unsaved changes to ${losing[0]}?`
            : `Discard unsaved changes to ${losing.length} files?`,
        confirmLabel: 'Discard',
        destructive: true,
      });
      if (!discard) return;
    }
    ws.closeTabs(group, paths);
  };
  const closeTab = (group: GroupIndex, path: string) => closeTabs(group, [path]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!closeBinding || e.defaultPrevented || !matchesBinding(e.nativeEvent, closeBinding)) return;
    const active = layout.groups[layout.focused]?.active;
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    void closeTab(layout.focused, active);
  };

  const reveal = useEditorTabs((s) => (s.reveal?.key === tabsKey ? s.reveal : null));
  const shown = useEditorTabs((s) => s.shown[tabsKey] ?? null);
  const clearReveal = useCallback((n: number) => useEditorTabs.getState().clearReveal(n), []);
  const split = layout.groups.length > 1;
  const openAt = useCallback(
    (path: string, range: TextRange) => useEditorTabs.getState().openAt(tabsKey, path, range),
    [tabsKey],
  );
  const openPreview = useCallback(
    (path: string) => useEditorTabs.getState().open(tabsKey, path, { preview: true }),
    [tabsKey],
  );
  // A PR view's next/previous thread or draft: each pane's toolbar buttons
  // drive the focused group's pane (the one clicked into), ⌥F9 each pane's own.
  const reviewNav = useReviewNavigation({
    view: ws.view,
    taskId: ws.activeTaskId,
    layout,
    onOpenAt: openAt,
    onOpen: openPreview,
  });
  // Editor-wide, so once: at the end of the last group's tab row, the
  // editor's top-right corner however it splits (the tree toggle holds the
  // first group's start). Language servers show here only when unwell, ahead
  // of the host's actions.
  const editorActions = (
    <>
      {ws.git && <LspStatusIndicator worktree={cwd} />}
      {actions}
    </>
  );

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
          const filePath = group.active;
          // A file outside the worktree opens plain (A10): working view, no git or comments.
          const plain = !!filePath && isOutsideWorktree(filePath);
          // A file `dashctl show`n opens on the working tree, whatever the view.
          const show = shown && shown.path === filePath ? shown : null;
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
                    onClose={(paths) => void closeTabs(index, paths)}
                    onPin={(path) => ws.pinTab(index, path)}
                    leading={i === 0 ? <TreeToggle /> : undefined}
                    trailing={isLast ? editorActions : null}
                  />
                  <div className={cn('flex min-h-0 flex-1 flex-col', folderSheet)}>
                    <GroupPane
                      active={group.active}
                      tabs={group.tabs}
                      onSelect={(path) => ws.activateTab(index, path)}
                    >
                      {filePath ? (
                        <EditorPane
                          paneId={`pane:${tabsKey}:${i}`}
                          group={index}
                          reviewNav={ws.view.kind === 'pr' && !plain ? reviewNav : undefined}
                          cwd={cwd}
                          git={ws.git && !plain}
                          filePath={filePath}
                          view={plain || show ? PLAIN_VIEW : ws.view}
                          show={show}
                          activeTaskId={plain ? null : ws.activeTaskId}
                          terminalTheme={terminalTheme}
                          isDark={isDark}
                          revealCommentId={ws.revealCommentId}
                          onNavigateToComment={ws.navigateToComment}
                          onClearReveal={ws.clearRevealComment}
                          projectId={plain ? null : ws.projectId}
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
                    </GroupPane>
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

/**
 * Whether the Monaco editor `el` is (Monaco scrolls itself, not natively)
 * can still scroll along `dx`, read off its horizontal scrollbar: the
 * slider's place and size along the track (a slider the track's width is a
 * file with nothing to scroll).
 */
const monacoScrollsAlong: ScrollProbe = (el, dx) => {
  if (!el.classList.contains('monaco-editor')) return false;
  const track = el.querySelector<HTMLElement>(
    ':scope > .overflow-guard > .editor-scrollable > .scrollbar.horizontal',
  );
  const slider = track?.querySelector<HTMLElement>(':scope > .slider');
  if (!track || !slider) return false;
  const left = parseFloat(slider.style.left) || 0;
  const width = parseFloat(slider.style.width) || 0;
  return dx > 0 ? left + width < track.clientWidth - 0.5 : left > 0.5;
};

/**
 * A group's pane in its sheet. Switching to another of its tabs never moves
 * it: a page of code sliding sideways is dizzying (U6), so the new file only
 * settles in place with its fade (`EditorViewport`), while the tab strip's
 * indicator glides. The one Monaco widget stays mounted. A sideways scroll
 * over it steps to the next or previous tab, unless the file under the
 * pointer can scroll that way (`useWheelTabSwitch`).
 */
function GroupPane({
  active,
  tabs,
  onSelect,
  children,
}: {
  active: string | null;
  tabs: string[];
  onSelect: (path: string) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useWheelTabSwitch(
    ref,
    (step) => {
      const next = active === null ? undefined : stepTab(tabs, active, step);
      if (next !== undefined) onSelect(next);
    },
    monacoScrollsAlong,
  );
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
