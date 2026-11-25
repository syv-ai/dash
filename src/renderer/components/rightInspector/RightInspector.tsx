import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { Info, MessageSquareCode, Minus, MoreHorizontal, Plus, X } from 'lucide-react';
import { FileChangesPanel } from '../changes/FileChangesPanel';
import { CommitPopover } from '../changes/CommitPopover';
import { useCommitRun } from '../changes/useCommitRun';
import { ShellDrawerWrapper } from '../terminal/ShellDrawerWrapper';
import { PortsDrawerWrapper } from './PortsDrawerWrapper';
import { UsageSection } from './UsageSection';
import { TaskDetails } from './TaskDetails';
import { IconButton } from '../ui/IconButton';
import { cn } from '../../lib/cn';
import { Segmented } from '../ui/Segmented';
import { CountBadge } from '../ui/CountBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  panelEaseMs,
  type PanelImperativeHandle,
} from '../ui/Resizable';
import { EditorTree } from '../diffEditor/EditorTree';
import { HistoryList } from '../diffEditor/HistoryList';
import { useEditorWorkspace, type EditorTarget } from '../diffEditor/useEditorWorkspace';
import { activePath, type OpenOptions } from '../diffEditor/tabs/editorLayout';
import { useTreePanel } from '../diffEditor/TreeToggle';
import {
  firstListedChange,
  firstTreeFile,
  onChangeCount,
  pickSegment,
  segmentOnExpand,
  type CodeSegment,
} from './sidebarState';
import { PrButton } from '../review/PrButton';
import { ReviewBanner } from '../review/ReviewBanner';
import { ReviewView } from '../review/ReviewView';
import { useReviewCheckout } from '../review/useReviewCheckout';
import { initialSegment, useReviewMode } from '../review/useReviewMode';
import { useReviewTally } from '../review/useReviewTally';
import { firstOpenThread } from '../review/outline';
import { useUnpushedCommits } from './useUnpushedCommits';
import type { SyncLinks } from '../changes/SyncStatus';
import { useGit } from '../../stores/gitStore';
import type { DiffFileTarget } from '../../stores/editorsStore';
import { useSettings } from '../../stores/settingsStore';
import { useUi } from '../../stores/uiStore';
import { useEditorTabs } from '../../stores/editorTabsStore';
import { useCommentsStore } from '../../stores/commentsStore';
import { formatBinding, matchesBinding, type KeyBinding } from '../../keybindings';
import { needsAttention } from '../../../shared/diffComments';
import type { ContextUsage, RateLimits, Task } from '../../../shared/types';
import type { LimitBurns } from '../../lib/burnRate';

const EditorGroups = lazy(() =>
  import('../diffEditor/EditorGroups').then((m) => ({ default: m.EditorGroups })),
);

/** What the sidebar's list shows: the changes, the whole repo and the
 *  commits, or in review mode the PR's overview, files, comments and commits
 *  (the view switch, always in words), or the task's details (an icon toggle
 *  at the row's end, read least often). */
type Segment = CodeSegment | 'details';

interface RightInspectorProps {
  task: Task;
  /** The model the task's session runs (live, from its status line). */
  modelName: string | null;
  /** The account's limits; undefined until a session reports one. */
  rateLimits?: RateLimits;
  burns: LimitBurns;
  contextUsage?: ContextUsage;
  /** What the editor opened on, or null while it isn't mounted (closed, or
   *  not yet: it mounts once the sidebar has eased to its expanded width).
   *  Each new target opens its file. */
  diff: DiffFileTarget | null;
  /** The editor shows beside the list (expanded); otherwise the sidebar is
   *  narrow, an open editor kept mounted out of sight. */
  expanded: boolean;
  terminalTheme: XtermTheme;
  isDark: boolean;
  onViewDiff: (filePath: string, staged: boolean) => void;
  /** Open the editor on its open tabs, expanding the sidebar. */
  onOpenEditor: () => void;
  /** Go narrow, keeping the editor (tabs, unsaved edits) out of sight. */
  onNarrow: () => void;
  onCloseDiff: () => void;
  onCommitFinished: () => void;
  shellDrawerRef: RefObject<PanelImperativeHandle | null>;
  onTuiActiveChange: (active: boolean, canvasPx?: number) => void;
  onTaskSettings: () => void;
}

/** The list column's narrowest in review mode, in px (D81). */
const REVIEW_LIST_MIN_PX = 320;

/** A tooltip label with its shortcut, e.g. "Stage all  ⇧⌘A". */
function withShortcut(label: string, binding: KeyBinding | undefined): string {
  return binding ? `${label}  ${formatBinding(binding)}` : label;
}

/**
 * The task sidebar: its usage on top, then the view switch.
 * Narrow: one column (the changes, the repo's file tree, or the commits)
 * over the task's terminals. Expanded, a file open: that column, under the
 * usage and the view switch, runs full height on the left; the editor sits
 * over the terminals on the right, from the sidebar's top.
 * Opening a file expands it; re-picking the current view goes back to
 * narrow, the editor kept mounted out of sight. Details, either way, spans
 * the whole body over the terminals. The terminals stay mounted throughout,
 * so the shell is never re-attached.
 */
export function RightInspector({
  task,
  modelName,
  rateLimits,
  burns,
  contextUsage,
  diff,
  expanded: expandedProp,
  terminalTheme,
  isDark,
  onViewDiff,
  onOpenEditor,
  onNarrow,
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
  const editorMounted = diff !== null;
  const expanded = expandedProp && editorMounted;
  // A task in review mode opens on Overview.
  const [segment, setSegment] = useState<Segment>(() => initialSegment(task.id));
  // Expanded, Details takes the whole body over the terminals, as narrow;
  // the editor stays mounted out of sight, so leaving Details finds it as it
  // was.
  const split = expanded && segment !== 'details';
  // Where the Details toggle returns to.
  const [lastCodeSegment, setLastCodeSegment] = useState<CodeSegment>(() =>
    initialSegment(task.id),
  );
  const showSegment = useCallback((next: CodeSegment) => {
    setSegment(next);
    setLastCodeSegment(next);
  }, []);
  const target = useMemo<EditorTarget | null>(
    () => (diff ? { filePath: diff.filePath, initialView: diff.initialView } : null),
    [diff],
  );
  // The diff's right side in review mode: the live file when the checkout is
  // at the PR's head and clean, else the head read-only, with a notice why.
  const checkout = useReviewCheckout(task);
  const ws = useEditorWorkspace({
    tabsKey: task.id,
    persistTabs: true,
    cwd: task.path,
    openTaskId: task.id,
    projectId: task.projectId,
    editorOpen: editorMounted,
    treeShown: segment === 'files',
    historyShown: segment === 'history',
    target,
    prLive: checkout.live,
  });
  const { view, selectView } = ws;
  // The working tree's changes, as Changes lists them (null: not loaded,
  // still the previous task's, or review mode's Changes, the PR's).
  const statusIsOwn = useGit((s) => s.gitStatusCwd === task.path);
  const changeCount =
    view.kind === 'working' && gitStatus && statusIsOwn ? gitStatus.files.length : null;
  const treePanel = useTreePanel();
  const openEditor = () => {
    if (!expanded) onOpenEditor();
  };
  // Opening a file is what expands the sidebar.
  const openFile = (path: string, opts?: OpenOptions) => {
    ws.openFile(path, opts);
    openEditor();
  };

  // ── Review mode: the PRs from and into the branch, and the one reviewed ──
  const review = useReviewMode(task, ws, { segment, showSegment, openFile, openEditor });
  const { mode } = review;
  const reviewing = mode !== null;
  const tally = useReviewTally(task.id, review.review);

  // Leaving History drops the commit it showed (D2): for the PR's view in
  // review mode, the working tree otherwise.
  const selectSegment = (next: CodeSegment) => {
    showSegment(next);
    review.onSegment(next);
  };
  // Re-picking the current view while expanded goes narrow (never collapsed:
  // that is the Hide control's, or ⌘⌥B's); while narrow, it expands on the
  // view's first file. Expanded with the tree folded away, picking another
  // view unfolds it, easing as the tree toggle does; leaving Details keeps
  // the fold as it was.
  const onPickSegment = (next: CodeSegment) => {
    const pick = pickSegment({
      current: segment,
      next,
      expanded,
      changeCount,
      listedChanges: files.length,
      openThread: !!review.review && firstOpenThread(review.review.threads) !== null,
    });
    if (pick === 'none') return;
    if (pick === 'expand') {
      useEditorTabs.getState().setTreeCollapsed(false);
      expandOn(next);
      return;
    }
    selectSegment(next);
    if (pick === 'narrow') {
      onNarrow();
      return;
    }
    if (expanded) useEditorTabs.getState().setTreeCollapsed(false);
  };
  // Expanding on a narrow view, as clicking its first row does: Changes'
  // first change; Files' last open file, else the tree's first; History's
  // commit (the one picked, else the newest), the editor then opening its
  // first file. Review mode decides for its Overview, Files and Comments.
  const expandOn = (on: CodeSegment) => {
    if (review.expandOn(on)) return;
    if (on === 'changes') {
      const change = firstListedChange(files);
      if (change) viewDiff(change.path, change.staged);
      return;
    }
    if (on === 'history') {
      const hash = view.kind === 'commit' ? view.hash : commits[0]?.hash;
      if (hash) pickView({ kind: 'commit', hash });
      else openEditor();
      return;
    }
    if (on === 'files' && activePath(ws.layout)) {
      openEditor();
      return;
    }
    const path = firstTreeFile(ws.data.repoPaths);
    if (path) openFile(path, { preview: true });
    else openEditor();
  };
  const toggleDetails = () => {
    if (segment === 'details') selectSegment(lastCodeSegment);
    else setSegment('details');
  };
  const viewDiff = useCallback(
    (filePath: string, staged: boolean) => {
      showSegment('changes');
      onViewDiff(filePath, staged);
    },
    [onViewDiff, showSegment],
  );
  // History: the branch's commits, or in review mode the PR's.
  const commits = review.commits ? review.commits.commits : ws.data.commits;
  const showPrCommits = () => {
    selectSegment('history');
    if (expanded) useEditorTabs.getState().setTreeCollapsed(false);
  };
  // An empty Changes is never expanded (see sidebarState): it narrows as it
  // empties, and gives way to Files as a file opens on it or its status
  // loads empty. Each reacts to its own transition, read off the value before.
  const countBefore = useRef(changeCount);
  useEffect(() => {
    const before = countBefore.current;
    countBefore.current = changeCount;
    const next = onChangeCount({ segment, expanded, before, now: changeCount });
    if (next === 'narrow') onNarrow();
    else if (next === 'files') showSegment('files');
  }, [segment, expanded, changeCount, onNarrow, showSegment]);
  // Mounting expanded (a task switched back to) counts as expanding.
  const expandedBefore = useRef(false);
  useEffect(() => {
    const before = expandedBefore.current;
    expandedBefore.current = expanded;
    if (before || !expanded || segment === 'details') return;
    const next = segmentOnExpand(segment, changeCount);
    if (next !== segment) showSegment(next);
  }, [segment, expanded, changeCount, showSegment]);
  // History's rows open what they pick in the editor.
  const pickView = (next: typeof view) => {
    selectView(next);
    openEditor();
  };
  // Details' Last commit and the ahead count: History (its column unfolded),
  // on that commit, its files unfolded. The editor opening sets its own
  // view, so with it closed the commit is picked once it is open.
  const [pendingCommit, setPendingCommit] = useState<string | null>(null);
  const openCommit = (hash: string) => {
    showSegment('history');
    useEditorTabs.getState().setTreeCollapsed(false);
    if (editorMounted) selectView({ kind: 'commit', hash });
    else setPendingCommit(hash);
    openEditor();
  };
  useEffect(() => {
    if (!editorMounted || !pendingCommit) return;
    selectView({ kind: 'commit', hash: pendingCommit });
    setPendingCommit(null);
  }, [editorMounted, pendingCommit, selectView]);
  // The ahead / behind counts: History on the newest unpushed commit (they
  // are marked there), and the commit graph on the upstream's tip.
  const unpushed = useUnpushedCommits(
    task.path,
    `${gitStatus?.ahead}:${gitStatus?.behind}:${ws.data.commits[0]?.hash}`,
  );
  const syncLinks: SyncLinks = {
    onShowUnpushed: () => {
      void window.electronAPI.gitGetUpstreamCommits(task.path).then((r) => {
        const newest = r.success ? r.data?.unpushed[0] : undefined;
        if (newest) openCommit(newest);
      });
    },
    onShowUpstream: () => {
      void window.electronAPI.gitGetUpstreamCommits(task.path).then((r) => {
        const tip = r.success ? r.data?.upstreamHead : null;
        if (tip) useGit.getState().openCommitGraphAtCommit(tip);
        else useGit.getState().setShowCommitGraph(true);
      });
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

  // Below 24rem the bulk actions fold into a menu and Commit drops its label,
  // so the views keep their room.
  const compact = '@max-sm/sidehead:hidden';
  // Working-tree actions: review mode's Changes are the PR's.
  const bulkActions = [
    !reviewing &&
      unstagedCount > 0 && {
        label: 'Stage all',
        binding: keybindings.stageAll,
        icon: <Plus size={14} strokeWidth={1.8} />,
        run: () => void stageAll(),
      },
    !reviewing &&
      stagedCount > 0 && {
        label: 'Unstage all',
        binding: keybindings.unstageAll,
        icon: <Minus size={14} strokeWidth={1.8} />,
        run: () => void unstageAll(),
      },
    // The editor holds the comments; this opens it. Review mode's Comments
    // tab counts and lists them itself.
    !reviewing &&
      commentCount > 0 && {
        label: `Comments: ${commentCount} to send`,
        binding: undefined,
        icon: <MessageSquareCode size={14} strokeWidth={1.8} />,
        run: onOpenEditor,
        count: commentCount,
      },
  ].filter((a) => a !== false);

  const header = (
    <div className="@container/sidehead flex h-11 shrink-0 items-center gap-0.5">
      {/* Who gives way as the row narrows, last first: the views (their
          counts go, then their padding tightens, then their labels truncate,
          never below a floor; `Segmented` fits itself), then
          Details and ✕ (never), Commit (its label goes below 24rem), the bulk
          actions (into a menu below 24rem), the PR button (normal mode only;
          review mode's banner sits above the row).
          Past all that the middle clips at its end, short of Details and ✕.
          The padding keeps focus outlines inside the clip. */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-hidden px-1">
        <div className={cn('-m-1 min-w-18 overflow-hidden p-1', !expanded && 'flex-auto')}>
          <Segmented<Segment>
            aria-label="Task sidebar view"
            size="sm"
            fullWidth={false}
            value={segment}
            onChange={(next) => next !== 'details' && onPickSegment(next)}
            options={
              reviewing
                ? [
                    { value: 'overview', label: 'Overview' },
                    {
                      value: 'files',
                      label: 'Files',
                      count: review.review?.files.length || undefined,
                    },
                    { value: 'comments', label: 'Comments', count: tally?.comments || undefined },
                    { value: 'history', label: 'History' },
                  ]
                : [
                    { value: 'changes', label: 'Changes', count: files.length || undefined },
                    { value: 'files', label: 'Files' },
                    { value: 'history', label: 'History' },
                  ]
            }
          />
        </div>
        {bulkActions.map((a) => (
          <div key={a.label} className={cn('flex shrink-0 items-center', compact)}>
            <IconButton size="sm" title={withShortcut(a.label, a.binding)} onClick={a.run}>
              {a.icon}
            </IconButton>
            {a.count !== undefined && <CountBadge count={a.count} className="-ml-1" />}
          </div>
        ))}
        {!reviewing && stagedCount > 0 && (
          <div className="ml-1 shrink-0">
            <CommitPopover run={run} labelClassName={compact} />
          </div>
        )}
        {bulkActions.length > 0 && (
          <div className="hidden shrink-0 @max-sm/sidehead:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" title="More actions">
                  <MoreHorizontal size={14} strokeWidth={1.8} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {bulkActions.map((a) => (
                  <DropdownMenuItem key={a.label} onSelect={a.run}>
                    {a.icon}
                    {a.label}
                    {a.binding && (
                      <DropdownMenuShortcut>{formatBinding(a.binding)}</DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {!reviewing && (
          <div className="ml-auto flex shrink-0 justify-end">
            <PrButton
              relevant={review.relevant}
              own={review.own}
              onOpen={review.refreshPrs}
              onPick={review.enter}
            />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          size="sm"
          title={segment === 'details' ? 'Hide details' : 'Details'}
          pressed={segment === 'details'}
          onClick={toggleDetails}
        >
          <Info size={14} strokeWidth={1.8} />
        </IconButton>
        {expanded && (
          <IconButton
            size="sm"
            title={withShortcut('Close editor', keybindings.closeDiff)}
            onClick={onCloseDiff}
          >
            <X size={14} strokeWidth={1.8} />
          </IconButton>
        )}
      </div>
    </div>
  );

  // Review mode's band, above the views it scopes.
  const banner = mode && (
    <div className="shrink-0 px-1 pt-1">
      <ReviewBanner mode={mode} state={review.review?.state ?? null} onExit={review.exit} />
    </div>
  );

  const usage = <UsageSection contextUsage={contextUsage} rateLimits={rateLimits} burns={burns} />;

  const history = (
    <HistoryList
      cwd={task.path}
      commits={commits}
      loading={review.commits ? review.commits.loading : ws.data.commitsLoading}
      view={view}
      onSelectView={pickView}
      commentCountByScope={ws.commentCountByScope}
      pr={review.historyPr}
      commitFiles={view.kind === 'commit' ? ws.data.changedFiles : []}
      activePath={activePath(ws.layout)}
      onOpenFile={openFile}
      unpushed={reviewing ? undefined : unpushed}
    />
  );

  const details = (
    <TaskDetails
      task={task}
      modelName={modelName}
      contextUsage={contextUsage}
      onEditSettings={onTaskSettings}
      onOpenCommit={openCommit}
      syncLinks={syncLinks}
    />
  );

  // The editor's tree: the changes or the whole repo (review mode has its own).
  const editorTree = (
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
      onOpenFile={openFile}
      canOpenToSide={ws.layout.groups.length < 2}
      badgeCounts={ws.badgeCounts}
    />
  );

  // Review mode's column: the PR's header over the picked view; its Files
  // list every file at the PR's head (the editor's view) on "All files".
  const reviewColumn = mode && segment !== 'details' && (
    <ReviewView
      task={task}
      mode={mode}
      tab={segment}
      repo={{
        paths: ws.data.repoPaths,
        dirs: ws.data.repoDirs,
        loading: ws.data.repoPathsLoading,
      }}
      history={history}
      tally={tally}
      activePath={activePath(ws.layout)}
      onOpenFile={review.openFile}
      canOpenToSide={ws.layout.groups.length < 2}
      onShowCommits={showPrCommits}
      notice={checkout.notice}
      onNavigate={review.navigate}
      onExit={review.exit}
    />
  );

  // The tree or list column: review mode's, the editor's tree (the changes
  // or the whole repo), or the commits. Narrow, Changes is the changes list
  // instead.
  const tree = reviewColumn || (segment === 'history' ? history : editorTree);

  // Narrow (and Details, expanded): the details, the changes list, or the
  // tree column alone.
  const list =
    segment === 'details' ? (
      details
    ) : reviewing || segment !== 'changes' ? (
      tree
    ) : (
      <FileChangesPanel
        key={task.id}
        loading={gitLoading}
        run={run}
        onViewDiff={viewDiff}
        syncLinks={syncLinks}
      />
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
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          autoSaveId="task-sidebar-columns"
          panelIds={split ? ['list', 'main'] : ['main']}
        >
          {/* Mounted only while split, ahead of "main", which keeps its place
              in the tree either way: the terminals below never remount. */}
          {split && (
            <>
              <ResizablePanel
                id="list"
                defaultSize="30%"
                // Review mode's header and rows need room for their counts and
                // actions beside their text; the tree and commits do with less.
                minSize={reviewing ? REVIEW_LIST_MIN_PX : '15%'}
                maxSize="50%"
                {...treePanel}
              >
                <div className="flex h-full min-h-0 flex-col pr-2">
                  {usage}
                  {banner}
                  {header}
                  <div className="min-h-0 flex-1">{withPorts(tree)}</div>
                </div>
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel id="main" minSize="40%">
            {/* The usage and view row lead the one column; split, they lead
                the list's, and the editor runs the full height. They sit
                ahead of the terminals, which keep their place either way. */}
            <div className="flex h-full min-h-0 flex-col">
              {!split && usage}
              {!split && banner}
              {!split && header}
              <div className="min-h-0 flex-1">
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
                  {/* Mounted while open, out of sight while narrow: its tabs,
                    scroll and unsaved edits wait for the next file to open. */}
                  {editorMounted && (
                    <div className={split ? 'h-full' : 'hidden'}>
                      <EditorSheet closeBinding={keybindings.closeDiff} onClose={onCloseDiff}>
                        <Suspense fallback={null}>
                          <EditorGroups ws={ws} terminalTheme={terminalTheme} isDark={isDark} />
                        </Suspense>
                      </EditorSheet>
                    </div>
                  )}
                  {!split && withPorts(list)}
                </ShellDrawerWrapper>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

/** The editor's place on the chrome, closed by Escape from inside it
 *  (Monaco's textarea skips the global shortcuts). Its groups draw their own
 *  sheets, each joined to its active tab. */
function EditorSheet({
  closeBinding,
  onClose,
  children,
}: {
  closeBinding: KeyBinding | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="h-full overflow-hidden"
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
