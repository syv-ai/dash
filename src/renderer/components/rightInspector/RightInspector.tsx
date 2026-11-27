import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import { Info, X } from 'lucide-react';
import { WorkingFiles, type RepoView } from '../changes/WorkingFiles';
import { CommitBar } from '../changes/CommitBar';
import { useCommitRun } from '../changes/useCommitRun';
import { ShellDrawerWrapper, expandShellDrawer } from '../terminal/ShellDrawerWrapper';
import { PortsDrawerWrapper } from './PortsDrawerWrapper';
import { UsageSection } from './UsageSection';
import { TaskRail } from './TaskRail';
import { RAIL_PX } from '../ui/Rail';
import type { RailShow } from './rail';
import { ViewRow, type ViewRowExtra } from './ViewRow';
import { viewRowMinPx } from './viewRowFit';
import { TaskDetails } from './TaskDetails';
import { AgentView } from './AgentView';
import type { AgentPane } from './agentTab';
import { IconButton } from '../ui/IconButton';
import { cn } from '../../lib/cn';
import { track } from '../../lib/telemetry';
import { useSettledTrack } from '../../lib/useSettledTrack';
import { ViewPanel, ViewTabs, type ViewTabsOption } from '../ui/ViewTabs';
import { MovableSlot, useMovable } from '../ui/Movable';
import { HeldFrame } from '../ui/HeldFrame';
import { folderSheet, folderStripSlot } from '../ui/FolderTab';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  panelEaseMs,
  type PanelImperativeHandle,
} from '../ui/Resizable';
import { commentScope } from '../diffEditor/comments/commentScope';
import { HistoryList } from '../diffEditor/HistoryList';
import { useEditorWorkspace, type EditorTarget } from '../diffEditor/useEditorWorkspace';
import { activePath, type OpenOptions } from '../diffEditor/tabs/editorLayout';
import { useTreePanel } from '../diffEditor/TreeToggle';
import {
  firstListedChange,
  firstTreeFile,
  pickSegment,
  type CodeSegment,
  type SidebarView,
} from './sidebarState';
import { defaultFilesScope, loadFilesScope, saveFilesScope, type FilesScope } from './filesScope';
import { viewOfSection } from '../changes/changeSections';
import {
  LIST_DEFAULTS,
  loadListWidth,
  saveListWidth,
  type ListMode,
} from '../../lib/inspectorWidths';
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
import { useShowOnScreen } from '../diffEditor/showFile';
import { useCommentsStore } from '../../stores/commentsStore';
import { matchesBinding, type KeyBinding } from '../../keybindings';
import type { ContextUsage, RateLimits, Task } from '../../../shared/types';
import type { LimitPaces } from '../../lib/pace';

const EditorGroups = lazy(() =>
  import('../diffEditor/EditorGroups').then((m) => ({ default: m.EditorGroups })),
);

/** What the sidebar's list shows: the files (the changes, or the whole repo
 *  with them) and the commits, or in review mode the PR's overview, files, comments and commits
 *  (the view switch, always in words), or the task's details. */
type Segment = SidebarView;

/** The sidebar mid-motion (App's `usePlannedMotion`): its content is held at
 *  `width` (px), first still (`held`: the layout paints), then while the
 *  panel's edge eases (`easing`), so the content clips rather than reflows.
 *  Between narrow and expanded it holds the expanded layout at the expanded
 *  width (the editor mounting clear, then fading in or out with the ease),
 *  the list split at `listPct` of it, as wide as the narrow column was (where
 *  it was, going narrow), so only the panel's edge and the editor move
 *  (D258). Shown or hidden, it holds the layout it has, at its open width,
 *  the editor as it is (D264). */
export interface SidebarMotion {
  width: number;
  to: 'expanded' | 'narrow' | 'shown' | 'hidden';
  phase: 'held' | 'easing';
  listPct?: number;
}

/** The motion goes between narrow and expanded: it holds the split. */
function holdsSplit(motion: SidebarMotion | null): boolean {
  return motion?.to === 'expanded' || motion?.to === 'narrow';
}

/** The editor's look mid-motion: shown before the ease going narrow and once
 *  it starts going expanded; fading only while it eases. */
function editorMotionClass(motion: SidebarMotion | null): string | false {
  if (!motion || !holdsSplit(motion)) return false;
  const easing = motion.phase === 'easing';
  const shown = motion.to === 'expanded' ? easing : !easing;
  return cn(
    // The panels' ease (App sets both while the sidebar moves).
    easing &&
      'transition-opacity duration-(--panel-ease) ease-(--panel-curve) motion-reduce:transition-none',
    !shown && 'opacity-0',
  );
}

interface RightInspectorProps {
  task: Task;
  /** The model the task's session runs (live, from its status line). */
  modelName: string | null;
  /** The account's limits; undefined until a session reports one. */
  rateLimits?: RateLimits;
  paces: LimitPaces;
  contextUsage?: ContextUsage;
  /** What the editor opened on, or null while it isn't mounted (closed, or
   *  not yet: it mounts once the sidebar has eased to its expanded width).
   *  Each new target opens its file. */
  diff: DiffFileTarget | null;
  /** The editor shows beside the list (expanded); otherwise the sidebar is
   *  narrow, an open editor kept mounted out of sight. */
  expanded: boolean;
  /** Mid-ease (see `SidebarMotion`): the expanded layout holds, going narrow
   *  included. */
  motion: SidebarMotion | null;
  /** The editor has mounted (true, its lazy chunk loaded and committed) or
   *  unmounted (false). */
  onEditorMounted?: (mounted: boolean) => void;
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
  /** The narrowest the sidebar may go (px) so its view tabs read in full;
   *  reported once measured, and again as the views change. */
  onMinWidth?: (px: number) => void;
  /** Collapsed (and not mid-motion): it shows its rail (`TaskRail`), the rest
   *  kept mounted out of sight (the editor's tabs and unsaved edits, the
   *  terminals) and out of reach of the keyboard. */
  railed: boolean;
  /** Show the sidebar narrow, from the rail; `terminal`: its drawer opened,
   *  the active terminal focused once the show is over. */
  onShow: (opts: { terminal: boolean }) => void;
}

/** The list column's narrowest in review mode, in px (D81). */
const REVIEW_LIST_MIN_PX = 320;

/**
 * The task sidebar: its usage on top, then the view switch.
 * Narrow: one column (the files, or the commits)
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
  paces,
  contextUsage,
  diff,
  expanded: expandedProp,
  motion,
  onEditorMounted,
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
  onMinWidth,
  railed,
  onShow,
}: RightInspectorProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  const gitLoading = useGit((s) => s.gitLoading);
  const keybindings = useSettings((s) => s.keybindings);
  const shellDrawerCollapsed = useSettings((s) => s.shellDrawerCollapsed);
  const setShellDrawerCollapsed = useSettings((s) => s.setShellDrawerCollapsed);
  const portsDrawerCollapsed = useSettings((s) => s.portsDrawerCollapsed);
  const setPortsDrawerCollapsed = useSettings((s) => s.setPortsDrawerCollapsed);
  const shellDrawerAnimating = useUi((s) => s.shellDrawerAnimating);
  const setShellDrawerAnimating = useUi((s) => s.setShellDrawerAnimating);
  const run = useCommitRun(task.path, onCommitFinished);

  // The task's notes and PR drafts: the editor's "n to send" and the PR
  // list's per-PR counts read them.
  useEffect(() => {
    if (useCommentsStore.getState().taskId !== task.id) {
      void useCommentsStore.getState().loadForTask(task.id);
    }
  }, [task.id]);

  // ── The editor's state: one workspace per task, open or not ──
  const editorMounted = diff !== null;
  // Going narrow, the expanded layout holds until the ease ends.
  const expanded = (expandedProp || holdsSplit(motion)) && editorMounted;
  useSettledTrack(
    'sidebar_mode_changed',
    'mode',
    railed ? 'rail' : expandedProp ? 'expanded' : 'narrow',
  );
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
  // Agent's pane: the session's scratchpad or the project's memory.
  const [agentPane, setAgentPane] = useState<AgentPane>('scratchpad');
  // Files' scope: the user's pick for this task, else the changes when its
  // status first loads with any, else all files. Taken once, so the tree
  // doesn't swap under the user as changes come and go.
  const statusIsOwn = useGit((s) => s.gitStatusCwd === task.path);
  const ownCount = gitStatus && statusIsOwn ? gitStatus.files.length : null;
  const [pickedScope, setPickedScope] = useState(() => loadFilesScope(task.id));
  const [firstScope, setFirstScope] = useState<FilesScope | null>(null);
  if (firstScope === null && ownCount !== null) setFirstScope(defaultFilesScope(ownCount));
  const scope: FilesScope = pickedScope ?? firstScope ?? 'changed';
  const pickScope = (next: FilesScope) => {
    setPickedScope(next);
    saveFilesScope(task.id, next);
  };
  const target = useMemo<EditorTarget | null>(
    () => (diff ? { filePath: diff.filePath, initialView: diff.initialView } : null),
    [diff],
  );
  // The diff's right side in review mode: the live file when the checkout is
  // at the PR's head and clean, else the head read-only, with a notice why.
  const checkout = useReviewCheckout(task);
  const ws = useEditorWorkspace({
    tabsKey: task.id,
    cwd: task.path,
    openTaskId: task.id,
    projectId: task.projectId,
    editorOpen: editorMounted,
    // Agent lists the worktree's CLAUDE.md files, from the same listing.
    treeShown: segment === 'files' || segment === 'agent',
    historyShown: segment === 'history',
    target,
    prLive: checkout.live,
  });
  const { view, selectView } = ws;
  // Expanded, the list column folds to the rail, never to nothing (T12).
  const { held: treeHeld, railed: treeRailed, ...treePanel } = useTreePanel(RAIL_PX);
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

  // Asked for this task's memory (a menu's "Memories", a project's count,
  // `showMemory`): Agent on its Memory pane, shown narrow if collapsed (A12).
  // Agent is normal mode's alone, so the ask ends review mode first.
  const memoryAsked = useUi((s) => s.memoryRequestTaskId === task.id);
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;
  const railedRef = useRef(railed);
  railedRef.current = railed;
  const exitReviewRef = useRef<(() => void) | null>(null);
  exitReviewRef.current = reviewing ? review.exit : null;
  useEffect(() => {
    if (!memoryAsked) return;
    useUi.getState().setMemoryRequestTaskId(null);
    exitReviewRef.current?.();
    showSegment('agent');
    setAgentPane('memory');
    if (railedRef.current) onShowRef.current({ terminal: false });
  }, [memoryAsked, showSegment]);
  // A file `dashctl show`n: the editor expanded, the list folded beside it.
  useShowOnScreen(task.id, expanded, () => {
    if (railedRef.current) onShowRef.current({ terminal: false });
    onOpenEditor();
  });

  // Leaving History drops the commit it showed (D2): for the PR's view in
  // review mode, the working tree otherwise.
  const selectSegment = (next: CodeSegment) => {
    showSegment(next);
    review.onSegment(next);
  };
  // Double-clicking the current view (`reselect`; a single click does
  // nothing) while expanded goes narrow (never collapsed: that is the Hide
  // control's, or ⌘⌥B's); while narrow, it expands on the view's first file.
  // Expanded with the tree folded away, picking another view unfolds it,
  // easing as the tree toggle does; leaving Details keeps the fold as it was.
  const onPickSegment = (next: CodeSegment, reselect: boolean) => {
    const pick = pickSegment({
      current: segment,
      next,
      reselect,
      expanded,
      changesOnly: !reviewing && scope === 'changed',
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
  // Expanding on a narrow view, as clicking its first row does: Files' first
  // change on its changes, else the last open file or the tree's first;
  // History's commit (the one picked, else the newest), the editor then
  // opening its first file. Review mode decides for its Overview, Files and
  // Comments.
  const expandOn = (on: CodeSegment) => {
    if (review.expandOn(on)) return;
    if (on === 'files' && scope === 'changed') {
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
  // The rail's clicks: the view tabs' own pick (a single click), or Details,
  // then show.
  const showFromRail = ({ view: on, terminal }: RailShow) => {
    if (on === 'details') setSegment('details');
    else if (on) onPickSegment(on, false);
    onShow({ terminal });
  };
  // The folded list column's rail: the same picks, unfolding the column
  // beside the editor; the terminal opens its drawer under the editor.
  const columnRef = useRef<HTMLDivElement>(null);
  const unfoldFromRail = ({ view: on, terminal }: RailShow) => {
    if (on === 'details') setSegment('details');
    else if (on) onPickSegment(on, false);
    useEditorTabs.getState().setTreeCollapsed(false);
    if (!terminal) return;
    const drawer = shellDrawerRef.current;
    if (drawer?.isCollapsed()) {
      setShellDrawerAnimating(true);
      expandShellDrawer(drawer);
    }
    requestAnimationFrame(() =>
      columnRef.current
        ?.querySelector<HTMLElement>('.terminal-drawer .xterm-helper-textarea')
        ?.focus(),
    );
  };
  const toggleDetails = () => {
    if (segment === 'details') selectSegment(lastCodeSegment);
    else setSegment('details');
  };
  const viewDiff = useCallback(
    (filePath: string, staged: boolean) => {
      showSegment('files');
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
  // Expanding on History opens the editor on the commit it picks. A row's
  // own click only picks it (unfolding its files): a file opens the editor.
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
  // Collapse/expand animates; the flag drops once the ease is over.
  const settleShellDrawer = (collapsed: boolean) => {
    setShellDrawerCollapsed(collapsed);
    if (!collapsed) track('terminal_drawer_opened');
    setTimeout(() => setShellDrawerAnimating(false), panelEaseMs());
  };

  // The commit actions, as Files' footer while it lists changes (review
  // mode's Files are the PR's).
  const commitBar = !reviewing &&
    segment === 'files' &&
    scope === 'changed' &&
    files.length > 0 && <CommitBar run={run} />;

  // The list column's width while split: its mode's own (`loadListWidth`),
  // taken as it splits and as the mode changes; kept only when the user
  // sets it on the divider, so a clamp never overwrites it.
  const listMode: ListMode = reviewing ? 'review' : 'normal';
  const listDragged = useRef(false);
  // A gesture on the divider: the layout change it makes is the user's. It
  // lapses shortly after the pointer or key lets go (a press that moved
  // nothing makes no change to claim).
  const listGesture = useMemo(() => {
    let lapse: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      clearTimeout(lapse);
      lapse = setTimeout(() => (listDragged.current = false), 300);
    };
    return () => {
      clearTimeout(lapse);
      listDragged.current = true;
      window.addEventListener('pointerup', end, { once: true, capture: true });
      window.addEventListener('keyup', end, { once: true, capture: true });
    };
  }, []);
  const listPanelRef = treePanel.panelRef;
  // Where the list splits: mid-motion (`motion.listPct`, D258), as wide as
  // the narrow column was, or (going narrow) where it was, so it doesn't
  // move; otherwise the mode's own.
  // Kept while split (`splitAt`): the library re-sizes a panel whose default
  // changes, so the motion's end must not hand it another. The motion's
  // width arrives a render after the split (App plans it in a layout
  // effect, before the paint) and wins.
  const motionListPct = motion?.listPct;
  const motionListPctRef = useRef(motionListPct);
  motionListPctRef.current = motionListPct;
  const [splitAt, setSplitAt] = useState<number | null>(null);
  const listWidth = motionListPct ?? splitAt ?? loadListWidth(listMode);
  if (!split && splitAt !== null) setSplitAt(null);
  if (split && splitAt !== listWidth) setSplitAt(listWidth);
  // As the mode changes while split (the column splits at it already: the
  // group's `defaultLayout`). The group registers its panels after this
  // render's effects, so the resize waits a frame.
  useEffect(() => {
    if (!split) return;
    listDragged.current = false;
    const frame = requestAnimationFrame(() => {
      const panel = listPanelRef.current;
      const pct = motionListPctRef.current ?? loadListWidth(listMode);
      if (panel && !panel.isCollapsed()) panel.resize(`${pct}%`);
    });
    return () => cancelAnimationFrame(frame);
  }, [split, listMode, listPanelRef]);

  // The view tabs' labels, measured: the list column (narrow, the sidebar)
  // never goes narrower than they and the row's chrome need.
  const [tabsMinPx, setTabsMinPx] = useState<number>();
  const listMinPx = tabsMinPx === undefined ? undefined : viewRowMinPx(tabsMinPx);
  useEffect(() => {
    if (listMinPx !== undefined) onMinWidth?.(listMinPx);
  }, [listMinPx, onMinWidth]);

  const extras: ViewRowExtra[] = [];
  // The PR button's state, for the row and the rail; normal mode only.
  const prs = reviewing
    ? null
    : {
        taskId: task.id,
        relevant: review.relevant,
        own: review.own,
        onOpen: review.refreshPrs,
        onPick: review.enter,
      };
  if (prs) {
    extras.push({
      key: 'pr',
      trailing: true,
      node: <PrButton {...prs} />,
      compact: <PrButton {...prs} variant="compact" />,
    });
  }

  // The views' tabs, in order (Details is the row's end button, not a tab).
  // Review mode has no Agent: the PR is the subject, not the session.
  const viewTabs: ViewTabsOption<Segment>[] = reviewing
    ? [
        { value: 'overview', label: 'Overview' },
        {
          value: 'files',
          label: 'Files',
          count: review.review?.files.length || undefined,
          countLabel: 'Changed files',
        },
        {
          value: 'threads',
          label: 'Threads',
          count: tally?.threads || undefined,
          countLabel: 'Unresolved',
        },
        { value: 'history', label: 'History' },
      ]
    : [
        {
          value: 'files',
          label: 'Files',
          count: files.length || undefined,
          countLabel: 'Changed files',
        },
        { value: 'history', label: 'History' },
        { value: 'agent', label: 'Agent' },
      ];

  // The commit actions are Files' footer (`CommitBar`), not the row's.
  const header = (
    <ViewRow
      tabsMinPx={tabsMinPx}
      extras={extras}
      endPressed={segment === 'details'}
      tabs={
        <ViewTabs<Segment>
          variant="folder"
          aria-label="Task sidebar view"
          value={segment}
          onChange={(next) => next !== 'details' && onPickSegment(next, false)}
          onReselect={(next) => next !== 'details' && onPickSegment(next, true)}
          onMinWidth={setTabsMinPx}
          options={viewTabs}
        />
      }
      end={
        <div className={folderStripSlot}>
          <IconButton
            size="sm"
            title={segment === 'details' ? 'Hide details' : 'Details'}
            pressed={segment === 'details'}
            onClick={toggleDetails}
          >
            <Info size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      }
    />
  );

  // Review mode's band, above the views it scopes.
  const banner = mode && (
    <div className="shrink-0 px-1 pt-1 pb-3">
      <ReviewBanner mode={mode} state={review.review?.state ?? null} onExit={review.exit} />
    </div>
  );

  const usage = <UsageSection contextUsage={contextUsage} rateLimits={rateLimits} paces={paces} />;

  const history = (
    <HistoryList
      cwd={task.path}
      commits={commits}
      loading={review.commits ? review.commits.loading : ws.data.commitsLoading}
      view={view}
      onSelectView={selectView}
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

  // Files: the changes (staged and unstaged) or the whole repo with them,
  // narrow and expanded alike. A change opens its diff: narrow, through the
  // editor's target (which expands); expanded, in the view of its section,
  // as a preview like any file's.
  const openChange = (path: string, staged: boolean, opts?: OpenOptions) => {
    if (!expanded) {
      viewDiff(path, staged);
      return;
    }
    const next = viewOfSection(staged ? 'staged' : 'unstaged');
    if (view.kind !== 'working' || view.ref !== next.ref) selectView(next);
    openFile(path, opts);
  };
  const repo: RepoView = {
    git: ws.git,
    paths: ws.data.repoPaths,
    dirs: ws.data.repoDirs,
    ignored: ws.data.repoIgnored,
    changedFiles: ws.data.changedFiles,
    loading: ws.data.repoPathsLoading || ws.data.changedFilesLoading,
    badges: ws.badgeCounts,
    // A badge opens the file at its first note, in the editor.
    openComment: (path, commentId) => {
      ws.navigateToComment(commentScope(view), path, commentId);
      openEditor();
    },
  };
  const filesView = (
    <WorkingFiles
      cwd={task.path}
      loading={gitLoading}
      scope={scope}
      onScope={pickScope}
      run={run}
      onOpenChange={openChange}
      onOpenFile={openFile}
      activePath={activePath(ws.layout)}
      view={view}
      canOpenToSide={ws.layout.groups.length < 2}
      repo={repo}
      syncLinks={syncLinks}
    />
  );

  // Agent (normal mode's): the session's scratchpad and the project's
  // memory. Their files open here, in the task's editor, as Files' do
  // (A10): a scratchpad or memory file by its absolute path, plain.
  const agentView = (
    <AgentView
      task={task}
      pane={agentPane}
      onPane={setAgentPane}
      repoPaths={ws.data.repoPaths}
      activePath={activePath(ws.layout)}
      onOpenFile={(path) => openFile(path, { preview: true })}
    />
  );

  // Review mode's column: the PR's header over the picked view; its Files
  // list every file at the PR's head (the editor's view) on "All files".
  const reviewColumn = mode && segment !== 'details' && segment !== 'agent' && (
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
      onShowTab={selectSegment}
      notice={checkout.notice}
      onNavigate={review.navigate}
      onExit={review.exit}
    />
  );

  // The tree or list column: review mode's, the files, the commits or Agent.
  const tree =
    reviewColumn || (segment === 'history' ? history : segment === 'agent' ? agentView : filesView);

  // Narrow (and Details, expanded): the details, or the tree column alone.
  const list = segment === 'details' ? details : tree;

  // The view tabs' sheet: the list under them, as an open file under its
  // tab, over Files' commit actions.
  const onSheet = (content: ReactNode) => (
    <div className={cn('flex h-full flex-col', folderSheet)}>
      <ViewPanel
        value={segment}
        order={viewTabs.map((t) => t.value)}
        onChange={(next) => next !== 'details' && onPickSegment(next, false)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {content}
      </ViewPanel>
      {commitBar}
    </div>
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

  // The column's top (usage, banner, view row) and its sheet move between
  // the one column (narrow) and the split's list column (expanded) without
  // remounting (D265): a remount re-measured them in the list panel before
  // it had a width (headers wrapping, usage dropping its rings), painting a
  // jump before the motion, and reset the tree's open folders and scroll.
  // Split, `list` is the tree.
  const top = useMovable(
    <>
      {usage}
      {banner}
      {header}
    </>,
  );
  const sheet = useMovable(withPorts(onSheet(list)));

  // The rail: the collapsed sidebar's, and the expanded one's list column
  // folded; `onShow` shows what it was clicked for.
  const rail = (onRailShow: (show: RailShow) => void) => (
    <TaskRail
      contextUsage={contextUsage}
      rateLimits={rateLimits}
      status={statusIsOwn ? gitStatus : null}
      prs={prs}
      onShow={onRailShow}
    />
  );

  return (
    <>
      {railed && <div className="h-full bg-ground pt-2 pr-2 pb-2">{rail(showFromRail)}</div>}
      {/* pb-2: the terminal sheet keeps the same 8px gutter from the window's
          bottom edge as the main sheet. The sheets (list, editor, terminals)
          share the terminal palette's ground. */}
      <div
        ref={columnRef}
        className={cn('flex h-full min-w-0 flex-col bg-ground pt-2 pr-2 pb-2', railed && 'hidden')}
        style={{ '--sheet-bg': terminalTheme.background } as CSSProperties}
      >
        {top.portal}
        {sheet.portal}
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={split ? { list: listWidth, main: 100 - listWidth } : undefined}
            onLayoutChanged={(layout) => {
              const panel = listPanelRef.current;
              if (!listDragged.current || layout.list === undefined || !panel) return;
              listDragged.current = false;
              saveListWidth(listMode, panel);
            }}
          >
            {/* Mounted only while split, ahead of "main", which keeps its place
              in the tree either way: the terminals below never remount. */}
            {split && (
              <>
                <ResizablePanel
                  id="list"
                  // Where it splits (`listWidth`); the divider's double click
                  // goes back to the mode's default.
                  defaultSize={`${listWidth}%`}
                  // Review mode's header and rows need room for their counts and
                  // actions beside their text (the tree and commits do with less),
                  // and the view tabs need theirs in full.
                  minSize={Math.max(listMinPx ?? 0, reviewing ? REVIEW_LIST_MIN_PX : 0) || '15%'}
                  // Review mode's wider default needs more room.
                  maxSize={reviewing ? '60%' : '50%'}
                  {...treePanel}
                >
                  {/* Folded, the rail; the column stays mounted out of
                      sight (its tree's open folders and scroll), held at its
                      width and faded as it folds and unfolds. */}
                  <HeldFrame held={treeHeld} railed={treeRailed}>
                    {treeRailed && <div className="h-full pr-2">{rail(unfoldFromRail)}</div>}
                    <div
                      className={cn('flex h-full min-h-0 flex-col pr-2', treeRailed && 'hidden')}
                    >
                      <MovableSlot host={top.host} />
                      <div className="min-h-0 flex-1">
                        <MovableSlot host={sheet.host} />
                      </div>
                    </div>
                  </HeldFrame>
                </ResizablePanel>
                {/* A press (a drag, the double click that resets) or a key on
                  it makes the width that follows the user's. */}
                <ResizableHandle
                  onPointerDown={listGesture}
                  onKeyDown={listGesture}
                  // Back to the mode's default, kept as the user's choice.
                  onDoubleClick={() => {
                    listDragged.current = true;
                    listPanelRef.current?.resize(`${LIST_DEFAULTS[listMode]}%`);
                  }}
                />
              </>
            )}
            <ResizablePanel id="main" minSize="40%">
              {/* The usage and view row lead the one column; split, they lead
                the list's, and the editor runs the full height. They sit
                ahead of the terminals, which keep their place either way. */}
              <div className="flex h-full min-h-0 flex-col">
                {!split && <MovableSlot host={top.host} />}
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
                      <div className={cn(split ? 'h-full' : 'hidden', editorMotionClass(motion))}>
                        <EditorSheet closeBinding={keybindings.closeDiff} onClose={onCloseDiff}>
                          <Suspense fallback={null}>
                            <EditorGroups
                              ws={ws}
                              terminalTheme={terminalTheme}
                              isDark={isDark}
                              actions={
                                <IconButton
                                  size="sm"
                                  title="Close editor"
                                  shortcut={keybindings.closeDiff}
                                  onClick={onCloseDiff}
                                >
                                  <X size={14} strokeWidth={1.8} />
                                </IconButton>
                              }
                            />
                            <OnMount onMount={onEditorMounted} />
                          </Suspense>
                        </EditorSheet>
                      </div>
                    )}
                    {!split && <MovableSlot host={sheet.host} />}
                  </ShellDrawerWrapper>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </>
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

/** Tells `onMount` once its Suspense boundary has committed (true), and
 *  when it goes (false). */
function OnMount({ onMount }: { onMount?: (mounted: boolean) => void }) {
  useEffect(() => {
    onMount?.(true);
    return () => onMount?.(false);
  }, [onMount]);
  return null;
}
