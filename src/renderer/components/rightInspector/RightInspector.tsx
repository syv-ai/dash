import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { FileDiff, FolderTree, History, Info, MessageSquareCode, Minus, Plus } from 'lucide-react';
import { FileChangesPanel } from '../changes/FileChangesPanel';
import { CommitPopover } from '../changes/CommitPopover';
import { useCommitRun } from '../changes/useCommitRun';
import { ShellDrawerWrapper } from '../terminal/ShellDrawerWrapper';
import { PortsDrawerWrapper } from './PortsDrawerWrapper';
import { UsageRow } from './UsageRow';
import { TaskDetails } from './TaskDetails';
import { IconButton } from '../ui/IconButton';
import { Segmented } from '../ui/Segmented';
import { CountBadge } from '../ui/CountBadge';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  panelEaseMs,
  type PanelImperativeHandle,
} from '../ui/Resizable';
import { EditorTree } from '../diffEditor/EditorTree';
import { HistoryList, type PrEntry } from '../diffEditor/HistoryList';
import { useEditorWorkspace, type EditorTarget } from '../diffEditor/useEditorWorkspace';
import { activePath } from '../diffEditor/tabs/editorLayout';
import { useTreePanel } from '../diffEditor/TreeToggle';
import { WorktreePath } from './WorktreePath';
import { useGit, type DiffFileTarget } from '../../stores/gitStore';
import { useSettings } from '../../stores/settingsStore';
import { useUi } from '../../stores/uiStore';
import { useCommentsStore } from '../../stores/commentsStore';
import { formatBinding, matchesBinding, type KeyBinding } from '../../keybindings';
import { needsAttention } from '../../../shared/diffComments';
import type { ContextUsage, RateLimits, Task } from '../../../shared/types';
import type { LimitBurns } from '../../lib/burnRate';

const EditorGroups = lazy(() =>
  import('../diffEditor/EditorGroups').then((m) => ({ default: m.EditorGroups })),
);

/** What the sidebar's list shows: the changes, the whole repo, the commits,
 *  or the task's details. Details comes last: the three code views keep
 *  their places (muscle memory), and it is the one read least often. */
type Segment = 'changes' | 'files' | 'history' | 'details';

const SEGMENT_ICON = { size: 14, strokeWidth: 1.8 } as const;

interface RightInspectorProps {
  task: Task;
  /** The model the task's session runs (live, from its status line). */
  modelName: string | null;
  rateLimits: RateLimits;
  burns: LimitBurns;
  contextUsage?: ContextUsage;
  /** What the editor opened on, or null while it is closed (the sidebar is
   *  narrow then). Each new target opens its file. */
  diff: DiffFileTarget | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  onViewDiff: (filePath: string, staged: boolean) => void;
  /** Open the editor on its open tabs. */
  onOpenEditor: () => void;
  onCloseDiff: () => void;
  onCommitFinished: () => void;
  shellDrawerRef: RefObject<PanelImperativeHandle | null>;
  onTuiActiveChange: (active: boolean, canvasPx?: number) => void;
  onTaskSettings: () => void;
}

/** A tooltip label with its shortcut, e.g. "Stage all  ⇧⌘A". */
function withShortcut(label: string, binding: KeyBinding | undefined): string {
  return binding ? `${label}  ${formatBinding(binding)}` : label;
}

/**
 * The task sidebar: its usage in one row on top, then the view switch.
 * Narrow: a list (changes, or the commits) over the task's terminals. Wide,
 * with the editor open: the list (the changes, the repo's files, or the
 * commits) runs full height on the left; the editor sits over the terminals
 * on the right. The terminals stay mounted across both, so the shell is
 * never re-attached.
 */
export function RightInspector({
  task,
  modelName,
  rateLimits,
  burns,
  contextUsage,
  diff,
  terminalTheme,
  isDark,
  onViewDiff,
  onOpenEditor,
  onCloseDiff,
  onCommitFinished,
  shellDrawerRef,
  onTuiActiveChange,
  onTaskSettings,
}: RightInspectorProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const gitLoading = useGit((s) => s.gitLoading);
  const stageAll = useGit((s) => s.stageAll);
  const unstageAll = useGit((s) => s.unstageAll);
  const keybindings = useSettings((s) => s.keybindings);
  const shellDrawerCollapsed = useSettings((s) => s.shellDrawerCollapsed);
  const setShellDrawerCollapsed = useSettings((s) => s.setShellDrawerCollapsed);
  const portsDrawerCollapsed = useSettings((s) => s.portsDrawerCollapsed);
  const setPortsDrawerCollapsed = useSettings((s) => s.setPortsDrawerCollapsed);
  const shellDrawerAnimating = useUi((s) => s.shellDrawerAnimating);
  const setShellDrawerAnimating = useUi((s) => s.setShellDrawerAnimating);
  const run = useCommitRun(task.path, onCommitFinished);

  // The task's notes to send and PR comments to submit, across every view.
  const commentCount = useCommentsStore((s) => {
    if (s.taskId !== task.id) return 0;
    let n = 0;
    for (const list of Object.values(s.byFile)) for (const c of list) if (needsAttention(c)) n++;
    return n;
  });
  useEffect(() => {
    if (useCommentsStore.getState().taskId !== task.id) {
      void useCommentsStore.getState().loadForTask(task.id);
    }
  }, [task.id]);

  // ── The editor's state: one workspace per task, open or not ──
  const wide = diff !== null;
  const [segment, setSegment] = useState<Segment>('changes');
  const target = useMemo<EditorTarget | null>(
    () => (diff ? { filePath: diff.filePath, initialView: diff.initialView } : null),
    [diff],
  );
  const ws = useEditorWorkspace({
    tabsKey: task.id,
    persistTabs: true,
    cwd: task.path,
    openTaskId: task.id,
    projectId: task.projectId,
    editorOpen: wide,
    historyShown: segment === 'history',
    target,
  });
  const { view, selectView } = ws;
  const treePanel = useTreePanel();
  const openEditor = () => {
    if (!wide) onOpenEditor();
  };

  // Changes and Files list the working tree (or the branch or PR compared
  // with): leaving History for them leaves the commit it showed.
  const selectSegment = (next: Segment) => {
    setSegment(next);
    if (next !== 'history' && view.kind === 'commit') selectView({ kind: 'working', ref: 'HEAD' });
    if (next === 'files') openEditor();
  };
  const viewDiff = useCallback(
    (filePath: string, staged: boolean) => {
      setSegment('changes');
      onViewDiff(filePath, staged);
    },
    [onViewDiff],
  );
  // History's rows open what they pick in the editor.
  const pickView = (next: typeof view) => {
    selectView(next);
    openEditor();
  };
  const pr: PrEntry | null = ws.prEntry && {
    ...ws.prEntry,
    onOpen: () => {
      ws.prEntry?.onOpen();
      openEditor();
    },
    onReview: () => {
      ws.prEntry?.onReview();
      openEditor();
    },
  };

  const files = gitStatus?.files ?? [];
  const stagedCount = files.filter((f) => f.staged).length;
  const unstagedCount = files.length - stagedCount;
  // Collapse/expand animates; the flag drops once the ease is over.
  const settleShellDrawer = (collapsed: boolean) => {
    setShellDrawerCollapsed(collapsed);
    setTimeout(() => setShellDrawerAnimating(false), panelEaseMs());
  };

  const header = (
    <div className="@container/sidehead flex h-11 shrink-0 items-center gap-0.5 pl-0.5">
      {/* Narrow, it takes the slack and gives it up first: the labels
          truncate before the actions are pushed out, and below 20rem fold
          to icons (four segments don't fit). Wide, the path does. */}
      <div className={wide ? 'shrink-0' : 'min-w-0 flex-1'}>
        <Segmented
          aria-label="Task sidebar view"
          size="sm"
          fullWidth={false}
          value={segment}
          onChange={selectSegment}
          labelClassName="@max-[20rem]/sidehead:sr-only"
          iconClassName="hidden @max-[20rem]/sidehead:flex"
          options={[
            {
              value: 'changes',
              label: 'Changes',
              icon: <FileDiff {...SEGMENT_ICON} />,
              count: files.length || undefined,
            },
            { value: 'files', label: 'Files', icon: <FolderTree {...SEGMENT_ICON} /> },
            { value: 'history', label: 'History', icon: <History {...SEGMENT_ICON} /> },
            { value: 'details', label: 'Details', icon: <Info {...SEGMENT_ICON} /> },
          ]}
        />
      </div>
      {unstagedCount > 0 && (
        <IconButton
          size="sm"
          title={withShortcut('Stage all', keybindings.stageAll)}
          onClick={() => void stageAll()}
        >
          <Plus size={14} strokeWidth={1.8} />
        </IconButton>
      )}
      {stagedCount > 0 && (
        <IconButton
          size="sm"
          title={withShortcut('Unstage all', keybindings.unstageAll)}
          onClick={() => void unstageAll()}
        >
          <Minus size={14} strokeWidth={1.8} />
        </IconButton>
      )}
      {/* The editor holds the comments; this opens it. */}
      {commentCount > 0 && (
        <>
          <IconButton size="sm" title={`Comments: ${commentCount} to send`} onClick={onOpenEditor}>
            <MessageSquareCode size={14} strokeWidth={1.8} />
          </IconButton>
          <CountBadge count={commentCount} className="-ml-1" />
        </>
      )}
      {stagedCount > 0 && (
        <div className="ml-1">
          <CommitPopover run={run} />
        </div>
      )}
      {wide && <WorktreePath path={task.path} className="ml-auto" />}
    </div>
  );

  const history = (
    <HistoryList
      commits={ws.data.commits}
      loading={ws.data.commitsLoading}
      view={view}
      onSelectView={pickView}
      commentCountByScope={ws.commentCountByScope}
      pr={pr}
      commitFiles={view.kind === 'commit' ? ws.data.changedFiles : []}
      activePath={activePath(ws.layout)}
      onOpenFile={ws.openFile}
    />
  );

  const details = (
    <TaskDetails
      task={task}
      modelName={modelName}
      contextUsage={contextUsage}
      onEditSettings={onTaskSettings}
    />
  );

  // Wide: the editor's tree (the changes or the whole repo), the commits, or
  // the details.
  const tree =
    segment === 'details' ? (
      details
    ) : segment === 'history' ? (
      history
    ) : (
      <EditorTree
        cwd={task.path}
        git={ws.git}
        view={view}
        allPaths={ws.data.repoPaths}
        repoDirs={ws.data.repoDirs}
        changedFiles={ws.data.changedFiles}
        changedOnly={segment === 'changes'}
        filesLoading={ws.data.repoPathsLoading || ws.data.changedFilesLoading}
        selectedPath={activePath(ws.layout) ?? ''}
        onOpenFile={ws.openFile}
        badgeCounts={ws.badgeCounts}
      />
    );

  // Narrow: the changes list, the commits or the details (Files opens the
  // editor).
  const list =
    segment === 'details' ? (
      details
    ) : segment === 'history' ? (
      history
    ) : (
      <FileChangesPanel key={task.id} loading={gitLoading} run={run} onViewDiff={viewDiff} />
    );

  const withPorts = (content: ReactNode) => (
    <PortsDrawerWrapper
      taskId={task.id}
      collapsed={portsDrawerCollapsed}
      onCollapse={() => setPortsDrawerCollapsed(true)}
      onExpand={() => setPortsDrawerCollapsed(false)}
    >
      <div className="flex h-full min-h-0 flex-col">{content}</div>
    </PortsDrawerWrapper>
  );

  return (
    // pb-2: the terminal sheet keeps the same 8px gutter from the window's
    // bottom edge as the main sheet.
    <div className="flex h-full min-w-0 flex-col bg-ground pt-2 pr-2 pb-2">
      <UsageRow contextUsage={contextUsage} rateLimits={rateLimits} burns={burns} />
      {header}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          autoSaveId="task-sidebar-columns"
          panelIds={wide ? ['list', 'main'] : ['main']}
        >
          {/* Mounted only while wide, ahead of "main", which keeps its place
              in the tree either way: the terminals below never remount. */}
          {wide && (
            <>
              <ResizablePanel
                id="list"
                defaultSize="30%"
                minSize="15%"
                maxSize="50%"
                {...treePanel}
              >
                <div className="h-full min-h-0 pr-2">{withPorts(tree)}</div>
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel id="main" minSize="40%">
            <div className="h-full min-h-0">
              <ShellDrawerWrapper
                taskId={task.id}
                cwd={task.path}
                collapsed={shellDrawerCollapsed}
                label={task.useWorktree ? 'Worktree' : 'Terminal'}
                terminalBg={terminalTheme.background}
                panelRef={shellDrawerRef}
                animating={shellDrawerAnimating}
                onAnimate={() => setShellDrawerAnimating(true)}
                onCollapse={() => settleShellDrawer(true)}
                onExpand={() => settleShellDrawer(false)}
                onTuiActiveChange={onTuiActiveChange}
              >
                {wide ? (
                  <EditorSheet
                    terminalBg={terminalTheme.background}
                    closeBinding={keybindings.closeDiff}
                    onClose={onCloseDiff}
                  >
                    <Suspense fallback={null}>
                      <EditorGroups
                        ws={ws}
                        terminalTheme={terminalTheme}
                        isDark={isDark}
                        onClose={onCloseDiff}
                      />
                    </Suspense>
                  </EditorSheet>
                ) : (
                  withPorts(list)
                )}
              </ShellDrawerWrapper>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

/** The editor's sheet, in the terminal's colours, closed by Escape from
 *  inside it (Monaco's textarea skips the global shortcuts). */
function EditorSheet({
  terminalBg,
  closeBinding,
  onClose,
  children,
}: {
  terminalBg: string | undefined;
  closeBinding: KeyBinding | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`h-full overflow-hidden rounded-xl border border-line ${
        terminalBg ? 'bg-(--sheet-bg)' : 'bg-well'
      }`}
      style={{ '--sheet-bg': terminalBg } as CSSProperties}
      onKeyDown={(e) => {
        // Monaco claims the keys it uses (closing its find widget) by
        // preventing their default.
        if (!closeBinding || e.defaultPrevented) return;
        if (!matchesBinding(e.nativeEvent, closeBinding)) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      {children}
    </div>
  );
}
