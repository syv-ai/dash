import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { DiffComment, FileChange } from '../../../shared/types';
import { needsAttention } from '../../../shared/diffComments';
import { parsePrScope } from '../../../shared/prScope';
import { useGit } from '../../stores/gitStore';
import { selectTaskByPath, useProjects } from '../../stores/projectsStore';
import { useCommentsStore } from '../../stores/commentsStore';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { selectLayout, useEditorTabs } from '../../stores/editorTabsStore';
import { unresolvedThreads } from '../../utils/prReviewNotices';
import type { EditorView } from './types';
import { useEditorViewData, type EditorViewData } from './data/useEditorViewData';
import { pickFirstChangedFile } from './data/viewData';
import { readStoredView, writeStoredView } from './data/viewPersistence';
import { commentScope, commentCountsByScope } from './comments/commentScope';
import {
  openPaths,
  type EditorLayout,
  type GroupIndex,
  type OpenOptions,
} from './tabs/editorLayout';
import { isDirty, workingUri } from './models';
import { absolutePath } from './editor/fileRef';
import { isFileTab } from './tabs/tabTarget';
import type { FileBadges } from './EditorTree';
import type { PrEntry } from './HistoryList';

const NO_COMMENTS: Record<string, DiffComment[]> = {};

/** What the editor opens with: a file to show (or '' to restore the tabs) and
 *  the view to show it in (absent: keep the current view). */
export interface EditorTarget {
  filePath: string;
  initialView?: EditorView;
}

interface Args {
  /** The tabs' workspace: a task's id, or the modal's folder. */
  tabsKey: string;
  /** Keep the tabs across restarts (a task's). */
  persistTabs: boolean;
  cwd: string;
  /** The task open in the window; its comments apply only in its own folder. */
  openTaskId: string | null;
  /** The project `cwd` belongs to; PR review calls name it. */
  projectId: string | null;
  /** The editor is open (shown or not): load its files and validate its view. */
  editorOpen: boolean;
  /** The file tree is showing (Files), with or without the editor. */
  treeShown?: boolean;
  /** The commit list is showing (History), with or without the editor. */
  historyShown: boolean;
  /** Each new target (by identity) opens its file and view. */
  target: EditorTarget | null;
}

export interface EditorWorkspace {
  tabsKey: string;
  cwd: string;
  /** `cwd` is a task's worktree: git applies. */
  git: boolean;
  /** The task whose comments show here, or null. */
  activeTaskId: string | null;
  projectId: string | null;
  view: EditorView;
  /** Show another view; a commit, branch or PR view opens its first changed
   *  file. Tabs the new view has nothing for close (see `selectView`). */
  selectView(next: EditorView): void;
  selectBase(base: string): void;
  exitBranchView(): void;
  /** Open PR `number`'s view; resolves false when it couldn't be loaded. */
  openPrView(number: number): Promise<boolean>;
  data: EditorViewData;
  layout: EditorLayout;
  openFile(path: string, opts?: OpenOptions): void;
  activateTab(group: GroupIndex, path: string): void;
  closeTab(group: GroupIndex, path: string): void;
  closeTabs(group: GroupIndex, paths: string[]): void;
  /** Keep a preview tab open. */
  pinTab(group: GroupIndex, path: string): void;
  focusGroup(group: GroupIndex): void;
  /** Per-file badges for the tree: comments in this view, PR threads. */
  badgeCounts: Map<string, FileBadges>;
  /** Comments needing attention per scope ('live', 'commit:<sha>'), for History. */
  commentCountByScope: Map<string, number>;
  /** The task's open PR, for History. */
  prEntry: PrEntry | null;
  /** A comment to reveal once its file shows (cross-file navigation). */
  revealCommentId: string | null;
  clearRevealComment(): void;
  navigateToComment(scope: string, path: string, commentId: string): void;
}

/** The README at the repo's root, if it has one. */
function findReadme(paths: string[]): string | null {
  return paths.find((p) => /^readme(\.(md|markdown|txt|rst))?$/i.test(p)) ?? null;
}

/**
 * The editor's state and data, apart from its layout: the view (working tree,
 * a commit, a branch or PR comparison), the tabs and groups (editorTabsStore),
 * the view's files and commits, comment badges and the task's PR. The task
 * sidebar lays its parts out in two columns; the modal beside each other.
 */
export function useEditorWorkspace({
  tabsKey,
  persistTabs,
  cwd,
  openTaskId,
  projectId,
  editorOpen,
  treeShown = false,
  historyShown,
  target,
}: Args): EditorWorkspace {
  // Git belongs to a task's worktree, and the task's comments to the active
  // task's. Any other folder (Claude's memory, opened from the memory modal)
  // is plain files: no git, no comments.
  const worktreeTaskId = useProjects((s) => selectTaskByPath(s, cwd)?.id ?? null);
  const git = worktreeTaskId !== null;
  const activeTaskId = worktreeTaskId === openTaskId ? openTaskId : null;
  const gitStatus = useGit((s) => s.gitStatus);

  // ── Tabs ──
  useEffect(() => {
    useEditorTabs.getState().load(tabsKey, persistTabs);
  }, [tabsKey, persistTabs]);
  const layout = useEditorTabs(selectLayout(tabsKey));
  const openFile = useCallback(
    (path: string, opts?: OpenOptions) => useEditorTabs.getState().open(tabsKey, path, opts),
    [tabsKey],
  );
  const pinTab = useCallback(
    (group: GroupIndex, path: string) => useEditorTabs.getState().pin(tabsKey, group, path),
    [tabsKey],
  );
  const activateTab = useCallback(
    (group: GroupIndex, path: string) => useEditorTabs.getState().activate(tabsKey, group, path),
    [tabsKey],
  );
  const closeTab = useCallback(
    (group: GroupIndex, path: string) => useEditorTabs.getState().close(tabsKey, group, path),
    [tabsKey],
  );
  const closeTabs = useCallback(
    (group: GroupIndex, paths: string[]) =>
      useEditorTabs.getState().closeMany(tabsKey, group, paths),
    [tabsKey],
  );
  const focusGroup = useCallback(
    (group: GroupIndex) => useEditorTabs.getState().focusGroup(tabsKey, group),
    [tabsKey],
  );

  // ── View ──
  // Restores the folder's last view; an explicit target view overrides it.
  const [view, setView] = useState<EditorView>(
    () => target?.initialView ?? readStoredView(cwd) ?? { kind: 'working', ref: 'HEAD' },
  );
  useEffect(() => {
    writeStoredView(cwd, view);
  }, [cwd, view]);

  // Picking a view (a commit, branch, PR, or back to the working tree) acts
  // once that view's files have loaded: see the effect below.
  const switchedTo = useRef<EditorView | null>(null);
  const selectView = useCallback((next: EditorView) => {
    switchedTo.current = next;
    setView(next);
  }, []);
  const selectBase = useCallback(
    (base: string) => selectView({ kind: 'branch', base }),
    [selectView],
  );
  const exitBranchView = useCallback(
    () => selectView({ kind: 'working', ref: 'HEAD' }),
    [selectView],
  );

  // ── View-dependent git data ──
  const workingFiles: FileChange[] = useMemo(
    () => (activeTaskId ? (gitStatus?.files ?? []) : []),
    [gitStatus, activeTaskId],
  );
  const data = useEditorViewData(cwd, view, workingFiles, git, {
    files: editorOpen || treeShown,
    commits: historyShown || editorOpen,
  });
  const { changedFiles, repoPaths, repoPathsLoading } = data;

  // Once the picked view's files are in: its tabs are the files it changes.
  // Others close, unless unsaved, or kept (not a preview) and the file is in
  // this view too. Non-file tabs (a PR's overview) stay. A commit, branch or PR view then opens its first changed
  // file (as a preview).
  const { settled } = data;
  useEffect(() => {
    // Closed, the editor loads no files: wait for it to open.
    if (switchedTo.current !== view || !editorOpen || !settled) return;
    switchedTo.current = null;
    const changed = new Set(changedFiles.map((f) => f.path));
    const present = new Set(repoPaths);
    useEditorTabs
      .getState()
      .retain(
        tabsKey,
        (path, preview) =>
          !isFileTab(path) ||
          changed.has(path) ||
          isDirty(workingUri(absolutePath(cwd, path))) ||
          (!preview && present.has(path)),
      );
    if (view.kind === 'working') return;
    const first = pickFirstChangedFile(changedFiles);
    if (first) openFile(first, { preview: true });
  }, [view, editorOpen, settled, changedFiles, repoPaths, tabsKey, cwd, openFile]);

  // ── Targets (a file clicked in the changes list, "Files", a comment) ──
  const wantReadme = useRef(false);
  useEffect(() => {
    if (!target) return;
    if (target.initialView) setView(target.initialView);
    if (target.filePath) openFile(target.filePath);
    else
      wantReadme.current = openPaths(selectLayout(tabsKey)(useEditorTabs.getState())).length === 0;
  }, [target, openFile, tabsKey]);
  // Nothing open yet: the README, when the repo has one.
  useEffect(() => {
    if (!wantReadme.current || repoPathsLoading || repoPaths.length === 0) return;
    wantReadme.current = false;
    const readme = findReadme(repoPaths);
    if (readme && openPaths(layout).length === 0) openFile(readme);
  }, [repoPaths, repoPathsLoading, layout, openFile]);

  // Validate a restored view once the editor opens: a commit's tree lists
  // every file, so an empty listing means the sha is gone; a branch base is
  // checked against the live branch list. Either miss → working.
  const validated = useRef(false);
  useEffect(() => {
    if (!editorOpen || validated.current) return;
    if (view.kind === 'working') {
      validated.current = true;
      return;
    }
    if (view.kind === 'commit' || view.kind === 'pr') {
      if (repoPathsLoading) return;
      validated.current = true;
      if (repoPaths.length === 0) setView({ kind: 'working', ref: 'HEAD' });
      return;
    }
    validated.current = true;
    const base = view.base;
    void window.electronAPI.gitListBranches(cwd).then((resp) => {
      const exists = resp.success && !!resp.data?.some((b) => b.ref === base);
      if (!exists) setView({ kind: 'working', ref: 'HEAD' });
    });
  }, [editorOpen, view, repoPaths, repoPathsLoading, cwd]);

  // ── Comments ──
  // Task-scoped, persisted to SQLite. With no task of its own the editor
  // leaves the store alone (it is the active task's) and shows none of it.
  const storedByFile = useCommentsStore((s) => s.byFile);
  const commentsByFile = activeTaskId ? storedByFile : NO_COMMENTS;
  useEffect(() => {
    if (activeTaskId) void useCommentsStore.getState().loadForTask(activeTaskId);
  }, [activeTaskId]);

  const [revealCommentId, setRevealCommentId] = useState<string | null>(null);
  const clearRevealComment = useCallback(() => setRevealCommentId(null), []);

  // ── The task's open PR and its review threads ──
  const openPr = useGit((s) => {
    const pr = activeTaskId ? s.prByTask[activeTaskId]?.[0] : undefined;
    return pr && pr.state === 'open' ? pr : null;
  });
  const viewReview = usePrReviews((s) =>
    view.kind === 'pr' ? (s.byPr[prKey(view.provider, view.number)] ?? null) : null,
  );
  const ownReview = usePrReviews((s) =>
    openPr ? (s.byPr[prKey(openPr.provider, openPr.number)] ?? null) : null,
  );
  const openPrView = useCallback(
    async (number: number) => {
      if (!projectId) return false;
      const loaded = await usePrReviews.getState().load(projectId, cwd, number);
      if (!loaded.ok) {
        toast.error(`Could not load PR #${number}: ${loaded.error}`);
        return false;
      }
      const { provider, base, head } = loaded.review;
      selectView({ kind: 'pr', provider, number, base, head });
      return true;
    },
    [projectId, cwd, selectView],
  );

  // Jump to a comment: switch to its view (scope) if needed, open its file,
  // and let the pane showing it reveal the comment once it hydrates. A live
  // comment stays in the current live view (working OR branch).
  const navigateToComment = useCallback(
    (scope: string, path: string, commentId: string) => {
      void (async () => {
        const pr = parsePrScope(scope);
        if (pr) {
          const here = view.kind === 'pr' && view.number === pr.number;
          if (!here && !(await openPrView(pr.number))) return;
        } else if (scope.startsWith('commit:')) {
          setView({ kind: 'commit', hash: scope.slice(7) });
        } else if (view.kind === 'commit' || view.kind === 'pr') {
          setView({ kind: 'working', ref: 'HEAD' });
        }
        openFile(path);
        setRevealCommentId(commentId);
      })();
    },
    [view, openPrView, openFile],
  );

  // A PR view restored from an earlier session has no review loaded yet: fetch
  // it (the PR may have moved on since), or fall back to the working tree.
  useEffect(() => {
    if (!editorOpen || view.kind !== 'pr' || viewReview || !projectId) return;
    let cancelled = false;
    void usePrReviews
      .getState()
      .load(projectId, cwd, view.number)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          toast.error(`Could not load PR #${view.number}: ${r.error}`);
          setView({ kind: 'working', ref: 'HEAD' });
        } else if (r.review.base !== view.base || r.review.head !== view.head) {
          setView({ ...view, base: r.review.base, head: r.review.head });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editorOpen, view, viewReview, projectId, cwd]);

  const prEntry: PrEntry | null = openPr
    ? {
        number: openPr.number,
        title: openPr.title,
        body: ownReview?.body ?? null,
        threads: ownReview ? unresolvedThreads(ownReview).length : null,
        onOpen: () => void openPrView(openPr.number),
        onReview: () => {
          if (activeTaskId)
            usePrReviews
              .getState()
              .setTarget(activeTaskId, { provider: openPr.provider, number: openPr.number });
          void openPrView(openPr.number);
        },
        onPeek: () => {
          if (!ownReview && projectId)
            void usePrReviews.getState().load(projectId, cwd, openPr.number);
        },
      }
    : null;

  // Your notes and comments in this view, and in a PR view its unresolved
  // threads too. Already-sent comments don't need attention.
  const currentScope = commentScope(view);
  const badgeCounts = useMemo(() => {
    const map = new Map<string, FileBadges>();
    const at = (path: string) => {
      let b = map.get(path);
      if (!b) map.set(path, (b = { comments: 0, threads: 0 }));
      return b;
    };
    for (const [path, list] of Object.entries(commentsByFile)) {
      const n = list.filter((c) => c.viewScope === currentScope && needsAttention(c)).length;
      if (n > 0) at(path).comments = n;
    }
    if (view.kind === 'pr' && viewReview) {
      for (const t of unresolvedThreads(viewReview)) at(t.path).threads++;
    }
    return map;
  }, [commentsByFile, currentScope, view.kind, viewReview]);

  const commentCountByScope = useMemo(() => commentCountsByScope(commentsByFile), [commentsByFile]);

  // Once the working tree's files are known, hard-delete persisted comments
  // whose path no longer exists.
  useEffect(() => {
    if (!activeTaskId || repoPathsLoading || repoPaths.length === 0) return;
    void useCommentsStore.getState().prune(new Set(repoPaths));
  }, [activeTaskId, repoPaths, repoPathsLoading]);

  return {
    tabsKey,
    cwd,
    git,
    activeTaskId,
    projectId,
    view,
    selectView,
    selectBase,
    exitBranchView,
    openPrView,
    data,
    layout,
    openFile,
    activateTab,
    closeTab,
    closeTabs,
    pinTab,
    focusGroup,
    badgeCounts,
    commentCountByScope,
    prEntry,
    revealCommentId,
    clearRevealComment,
    navigateToComment,
  };
}
