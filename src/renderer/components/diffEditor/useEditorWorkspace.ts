import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '../ui/toast';
import type { DiffComment, FileChange, PrRef } from '../../../shared/types';
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
  activePath,
  openPaths,
  type EditorLayout,
  type GroupIndex,
  type OpenOptions,
} from './tabs/editorLayout';
import { isDirty, workingUri } from './models';
import { absolutePath, isOutsideWorktree } from './editor/fileRef';
import type { FileBadges } from '../fileTree/model';

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
  /** A PR's view shows the live working file on its right (review mode, the
   *  checkout at the PR's head; see `reviewCheckout`). */
  prLive?: boolean;
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
  /** Show another view; a commit or PR view opens its first changed file.
   *  Tabs the new view has nothing for close (see `selectView`). */
  selectView(next: EditorView): void;
  /** Show the PR's view at the head its review was last loaded at, loading
   *  it first if it isn't; resolves false (with a toast) when it couldn't be. */
  showPr(pr: PrRef): Promise<boolean>;
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
 * a commit, or a PR in review mode), the tabs and groups (editorTabsStore),
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
  prLive = false,
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
  // A PR's view is picked at its head and shown live or not as `prLive` says.
  const [picked, setView] = useState<EditorView>(
    () => target?.initialView ?? readStoredView(cwd) ?? { kind: 'working', ref: 'HEAD' },
  );
  const view = useMemo<EditorView>(
    () => (picked.kind === 'pr' && !!picked.live !== prLive ? { ...picked, live: prLive } : picked),
    [picked, prLive],
  );
  useEffect(() => {
    writeStoredView(cwd, picked);
  }, [cwd, picked]);

  // Picking a view (a commit, a PR, or back to the working tree) acts once
  // that view's files have loaded: see the effect below.
  const switchedTo = useRef<EditorView | null>(null);
  const selectView = useCallback((next: EditorView) => {
    switchedTo.current = next;
    setView(next);
  }, []);
  const viewRef = useRef(view);
  viewRef.current = view;

  // ── View-dependent git data ──
  const workingFiles: FileChange[] = useMemo(
    () => (activeTaskId ? (gitStatus?.files ?? []) : []),
    [gitStatus, activeTaskId],
  );
  const headSha = activeTaskId ? (gitStatus?.headSha ?? null) : null;
  const data = useEditorViewData(cwd, view, workingFiles, headSha, git, {
    files: editorOpen || treeShown,
    commits: historyShown || editorOpen,
  });
  const { changedFiles, repoPaths, repoPathsLoading } = data;

  // Once the picked view's files are in: its tabs are the files it changes.
  // Others close, unless unsaved, or kept (not a preview) and the file is in
  // this view too. A commit or PR view then
  // opens its first changed file (as a preview), unless one of
  // its files already shows.
  const { settled } = data;
  useEffect(() => {
    // Closed, the editor loads no files: wait for it to open.
    if (switchedTo.current !== picked || !editorOpen || !settled) return;
    switchedTo.current = null;
    const changed = new Set(changedFiles.map((f) => f.path));
    const present = new Set(repoPaths);
    useEditorTabs.getState().retain(
      tabsKey,
      (path, preview) =>
        // A file outside the worktree (A10) is in no view: it stays.
        isOutsideWorktree(path) ||
        changed.has(path) ||
        isDirty(workingUri(absolutePath(cwd, path))) ||
        (!preview && present.has(path)),
    );
    if (view.kind === 'working') return;
    // Opened from a list before the view settled (Review's files): that stays
    // in front.
    const shown = activePath(selectLayout(tabsKey)(useEditorTabs.getState()));
    if (shown && changed.has(shown)) return;
    const first = pickFirstChangedFile(changedFiles);
    if (first) openFile(first, { preview: true });
  }, [view, picked, editorOpen, settled, changedFiles, repoPaths, tabsKey, cwd, openFile]);

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

  // Validate a restored commit view once the editor opens: a commit's tree
  // lists every file, so an empty listing means the sha is gone → working.
  // (A PR's view is never restored: review mode shows it afresh.)
  const validated = useRef(false);
  useEffect(() => {
    if (!editorOpen || validated.current) return;
    if (view.kind !== 'commit') {
      validated.current = true;
      return;
    }
    // Settled, not merely not loading: in the render the editor opens in,
    // the listing (skipped while closed) has not started and reads empty.
    if (!settled) return;
    validated.current = true;
    if (repoPaths.length === 0) setView({ kind: 'working', ref: 'HEAD' });
  }, [editorOpen, view, repoPaths, settled]);

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

  // ── The PR's review threads, in a PR's view ──
  const viewReview = usePrReviews((s) =>
    view.kind === 'pr' ? (s.byPr[prKey(view.provider, view.number)] ?? null) : null,
  );
  const showPr = useCallback(
    async ({ provider, number }: PrRef): Promise<boolean> => {
      if (!projectId) return false;
      let review = usePrReviews.getState().byPr[prKey(provider, number)];
      if (!review) {
        const loaded = await usePrReviews.getState().load(projectId, cwd, number);
        if (!loaded.ok) {
          toast.error(`Could not load PR #${number}: ${loaded.error}`);
          return false;
        }
        review = loaded.review;
      }
      const { base, head } = review;
      const v = viewRef.current;
      const same =
        v.kind === 'pr' &&
        v.provider === provider &&
        v.number === number &&
        v.base === base &&
        v.head === head;
      if (!same) selectView({ kind: 'pr', provider, number, base, head });
      return true;
    },
    [projectId, cwd, selectView],
  );

  // Jump to a comment: switch to its view (scope) if needed, open its file,
  // and let the pane showing it reveal the comment once it hydrates.
  const navigateToComment = useCallback(
    (scope: string, path: string, commentId: string) => {
      void (async () => {
        const pr = parsePrScope(scope);
        if (pr) {
          const here = view.kind === 'pr' && view.number === pr.number;
          if (!here && !(await showPr(pr))) return;
        } else if (scope.startsWith('commit:')) {
          setView({ kind: 'commit', hash: scope.slice(7) });
        } else if (view.kind === 'commit' || view.kind === 'pr') {
          setView({ kind: 'working', ref: 'HEAD' });
        }
        openFile(path);
        setRevealCommentId(commentId);
      })();
    },
    [view, showPr, openFile],
  );

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
    showPr,
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
    revealCommentId,
    clearRevealComment,
    navigateToComment,
  };
}
