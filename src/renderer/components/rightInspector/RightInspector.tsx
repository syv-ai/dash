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
import { HistoryList, type PrEntry } from '../diffEditor/HistoryList';
import { useEditorWorkspace, type EditorTarget } from '../diffEditor/useEditorWorkspace';
import { activePath, type OpenOptions } from '../diffEditor/tabs/editorLayout';
import { useTreePanel } from '../diffEditor/TreeToggle';
import { WorktreePath } from './WorktreePath';
import {
  onChangeCount,
  pickSegment,
  prViewLags,
  segmentForTarget,
  segmentOnExpand,
  viewOnSegment,
  type CodeSegment,
} from './sidebarState';
import { ReviewView } from '../review/ReviewView';
import { useReviewTarget } from '../review/useReviewTarget';
import { prTab } from '../diffEditor/tabs/tabTarget';
import { useUnpushedCommits } from './useUnpushedCommits';
import type { SyncLinks } from '../changes/SyncStatus';
import { useGit } from '../../stores/gitStore';
import type { DiffFileTarget } from '../../stores/editorsStore';
import { useSettings } from '../../stores/settingsStore';
import { useUi } from '../../stores/uiStore';
import { useEditorTabs } from '../../stores/editorTabsStore';
import { useCommentsStore } from '../../stores/commentsStore';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { unresolvedThreads } from '../../utils/prReviewNotices';
import { formatBinding, matchesBinding, type KeyBinding } from '../../keybindings';
import { needsAttention } from '../../../shared/diffComments';
import type { ContextUsage, PrRef, RateLimits, Task } from '../../../shared/types';
import type { LimitBurns } from '../../lib/burnRate';

const EditorGroups = lazy(() =>
  import('../diffEditor/EditorGroups').then((m) => ({ default: m.EditorGroups })),
);

/** What the sidebar's list shows: the changes, the whole repo, the commits
 *  or the PR under review (the view switch, always in words), or the task's
 *  details (an icon toggle at the row's end, read least often). */
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

/** A tooltip label with its shortcut, e.g. "Stage all  ⇧⌘A". */
function withShortcut(label: string, binding: KeyBinding | undefined): string {
  return binding ? `${label}  ${formatBinding(binding)}` : label;
}

/**
 * The task sidebar: its usage on top, then the view switch.
 * Narrow: one column (the changes, the repo's file tree, or the commits)
 * over the task's terminals. Expanded, a file open: that column runs full
 * height on the left; the editor sits over the terminals on the right.
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

  // ── The PR the task reviews (the Review view's) ──
  const { target: reviewTarget, stored: storedTarget, own: ownPr } = useReviewTarget(task.id);
  const reviewThreads = usePrReviews((s) => {
    const review = reviewTarget && s.byPr[prKey(reviewTarget.provider, reviewTarget.number)];
    return review ? unresolvedThreads(review).length : 0;
  });

  // ── The editor's state: one workspace per task, open or not ──
  const editorMounted = diff !== null;
  const expanded = expandedProp && editorMounted;
  const [segment, setSegment] = useState<Segment>('changes');
  // Expanded, Details takes the whole body over the terminals, as narrow;
  // the editor stays mounted out of sight, so leaving Details finds it as it
  // was.
  const split = expanded && segment !== 'details';
  // Where the Details toggle returns to.
  const [lastCodeSegment, setLastCodeSegment] = useState<CodeSegment>('changes');
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
    editorOpen: editorMounted,
    treeShown: segment === 'files',
    historyShown: segment === 'history',
    target,
    // Compare → Pull requests: the PR is the target now, and its view shows;
    // Review lists it.
    onReviewPr: () => {
      setSegment('review');
      setLastCodeSegment('review');
    },
  });
  const { view, selectView } = ws;
  // The working tree's changes, as Changes lists them (null: not loaded,
  // still the previous task's, or a branch or PR view's Changes).
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

  // The PR's view in the editor: at once when its review is loaded (from
  // History's hover, an earlier visit), else once it is.
  const showPr = (pr: PrRef) => {
    const loaded = usePrReviews.getState().byPr[prKey(pr.provider, pr.number)];
    const same = view.kind === 'pr' && view.provider === pr.provider && view.number === pr.number;
    if (same && (!loaded || (loaded.base === view.base && loaded.head === view.head))) return;
    if (loaded) selectView({ kind: 'pr', ...pr, base: loaded.base, head: loaded.head });
    else void ws.openPrView(pr.number);
  };
  // Review shows the target PR in the editor; leaving it for Changes or
  // Files returns to the working tree, as leaving History drops the commit
  // it showed (D2). `pr` names the target before the store's has updated.
  const selectSegment = (next: CodeSegment, pr: PrRef | null | undefined = reviewTarget) => {
    setSegment(next);
    setLastCodeSegment(next);
    const nextView = viewOnSegment({ from: segment, to: next, viewKind: view.kind });
    if (nextView === 'working') selectView({ kind: 'working', ref: 'HEAD' });
    else if (nextView === 'pr' && pr) showPr(pr);
  };
  // On Review the editor's PR view follows the target and its head: Stop
  // reviewing falling back to the own PR, a refresh finding a new push (D38).
  const targetReview = usePrReviews((s) =>
    reviewTarget ? (s.byPr[prKey(reviewTarget.provider, reviewTarget.number)] ?? null) : null,
  );
  const lags = prViewLags({ segment, view, target: reviewTarget, review: targetReview });
  const showPrRef = useRef(showPr);
  showPrRef.current = showPr;
  useEffect(() => {
    if (lags && reviewTarget) showPrRef.current(reviewTarget);
  }, [lags, reviewTarget]);
  // Review shows while the task has a target; it gives way to Changes once
  // the target is gone (Stop reviewing, the own PR merged), and the editor
  // to the working tree.
  useEffect(() => {
    if (segmentForTarget(segment, reviewTarget) === segment) return;
    setSegment('changes');
    setLastCodeSegment('changes');
    if (view.kind === 'pr') selectView({ kind: 'working', ref: 'HEAD' });
  }, [segment, reviewTarget, view.kind, selectView]);
  // Re-picking the current view while expanded goes narrow (never collapsed:
  // that is the Hide control's, or ⌘⌥B's). Expanded with the tree folded
  // away, picking another view unfolds it, easing as the tree toggle does;
  // leaving Details keeps the fold as it was.
  const onPickSegment = (next: CodeSegment) => {
    const pick = pickSegment({ current: segment, next, expanded, changeCount });
    if (pick === 'none') return;
    selectSegment(next);
    if (pick === 'narrow') {
      onNarrow();
      return;
    }
    if (expanded) useEditorTabs.getState().setTreeCollapsed(false);
  };
  const toggleDetails = () => {
    if (segment === 'details') selectSegment(lastCodeSegment);
    else setSegment('details');
  };
  const viewDiff = useCallback(
    (filePath: string, staged: boolean) => {
      setSegment('changes');
      setLastCodeSegment('changes');
      onViewDiff(filePath, staged);
    },
    [onViewDiff],
  );
  // History's Review: the PR becomes the target, and Review shows it.
  const reviewPr = (pr: PrRef) => {
    usePrReviews.getState().setTarget(task.id, pr);
    selectSegment('review', pr);
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
    else if (next === 'files') {
      setSegment('files');
      setLastCodeSegment('files');
    }
  }, [segment, expanded, changeCount, onNarrow]);
  // Mounting expanded (a task switched back to) counts as expanding.
  const expandedBefore = useRef(false);
  useEffect(() => {
    const before = expandedBefore.current;
    expandedBefore.current = expanded;
    if (before || !expanded || segment === 'details') return;
    const next = segmentOnExpand(segment, changeCount);
    if (next === segment) return;
    setSegment(next);
    setLastCodeSegment(next);
  }, [segment, expanded, changeCount]);
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
    setSegment('history');
    setLastCodeSegment('history');
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
  const pr: PrEntry | null = ws.prEntry && {
    ...ws.prEntry,
    onOpen: () => {
      ws.prEntry?.onOpen();
      openEditor();
    },
    onReview: () => {
      if (ownPr) reviewPr(ownPr);
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
  const bulkActions = [
    unstagedCount > 0 && {
      label: 'Stage all',
      binding: keybindings.stageAll,
      icon: <Plus size={14} strokeWidth={1.8} />,
      run: () => void stageAll(),
    },
    stagedCount > 0 && {
      label: 'Unstage all',
      binding: keybindings.unstageAll,
      icon: <Minus size={14} strokeWidth={1.8} />,
      run: () => void unstageAll(),
    },
    // The editor holds the comments; this opens it.
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
          padding tightens, their labels truncate, never below a floor), then
          Details and ✕ (never), Commit (its label goes below 24rem), the bulk
          actions (into a menu below 24rem), the path (it only takes slack).
          Past all that the middle clips at its end, short of Details and ✕.
          The padding keeps focus outlines inside the clip. */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-hidden px-1">
        <div className={cn('-m-1 min-w-18 overflow-hidden p-1', !expanded && 'flex-1')}>
          <Segmented<Segment>
            aria-label="Task sidebar view"
            size="sm"
            fullWidth={false}
            value={segment}
            onChange={(next) => next !== 'details' && onPickSegment(next)}
            segmentClassName="@max-[20rem]/sidehead:px-1.5"
            options={[
              { value: 'changes', label: 'Changes', count: files.length || undefined },
              { value: 'files', label: 'Files' },
              { value: 'history', label: 'History' },
              ...(reviewTarget
                ? [{ value: 'review' as const, label: 'Review', count: reviewThreads || undefined }]
                : []),
            ]}
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
        {stagedCount > 0 && (
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
        {expanded && (
          <div className="flex min-w-0 flex-1 justify-end overflow-hidden">
            <WorktreePath path={task.path} className="shrink" />
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

  const history = (
    <HistoryList
      cwd={task.path}
      commits={ws.data.commits}
      loading={ws.data.commitsLoading}
      view={view}
      onSelectView={pickView}
      commentCountByScope={ws.commentCountByScope}
      pr={pr}
      commitFiles={view.kind === 'commit' ? ws.data.changedFiles : []}
      activePath={activePath(ws.layout)}
      onOpenFile={openFile}
      unpushed={unpushed}
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

  const review = (
    <ReviewView
      task={task}
      target={reviewTarget}
      // Stopping a review of the own PR would leave it the target still.
      canStop={
        !!storedTarget &&
        !(ownPr && ownPr.provider === storedTarget.provider && ownPr.number === storedTarget.number)
      }
      activePath={activePath(ws.layout)}
      onOpenFile={(path) => openFile(path, { preview: true })}
      onOpenOverview={(target) => openFile(prTab(target.provider, target.number))}
      onNavigate={(scope, path, id) => {
        ws.navigateToComment(scope, path, id);
        openEditor();
      }}
    />
  );

  // The tree or list column: the editor's tree (the changes or the whole
  // repo), the commits, or the review's outline. Narrow, Changes is the
  // changes list instead.
  const tree =
    segment === 'history' ? (
      history
    ) : segment === 'review' ? (
      review
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
        onOpenFile={openFile}
        canOpenToSide={ws.layout.groups.length < 2}
        badgeCounts={ws.badgeCounts}
      />
    );

  // Narrow (and Details, expanded): the details, the changes list, or the
  // tree column alone.
  const list =
    segment === 'details' ? (
      details
    ) : segment !== 'changes' ? (
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
      <UsageSection contextUsage={contextUsage} rateLimits={rateLimits} burns={burns} />
      {header}
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
