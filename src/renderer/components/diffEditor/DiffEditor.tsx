import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { FileChange } from '../../../shared/types';
import { useGit } from '../../stores/gitStore';
import { EditorSidebar } from './EditorSidebar';
import { EditorPane } from './EditorPane';
import type { EditorView } from './types';
import type { DiffEditorModalProps } from './DiffEditorModal';
import { useEditorViewData } from './data/useEditorViewData';
import { pickFirstChangedFile } from './data/viewData';
import { readStoredView, writeStoredFile, writeStoredView } from './data/viewPersistence';
import { useCommentsStore } from '../../stores/commentsStore';
import { prKey, usePrReviews } from '../../stores/prReviewStore';
import { useTaskReview } from './prReview/useTaskReview';
import { unresolvedThreads } from '../../utils/prReviewNotices';
import { toast } from 'sonner';
import type { FileBadges, PrEntry } from './EditorSidebar';
import { commentScope, commentCountsByScope } from './comments/commentScope';
import { needsAttention } from '../../../shared/diffComments';
import { parsePrScope } from '../../../shared/prScope';

/** Composition-root workspace: owns view state, drives the data loaders, and
 *  lays out the sidebar + editor pane. Rendered inside <DiffEditorModal>. */
export function DiffEditor({
  cwd,
  initialFilePath,
  initialStaged,
  initialView,
  activeTaskId,
  projectId,
  terminalTheme,
  isDark,
  onClose,
}: DiffEditorModalProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  // View precedence: an explicit caller intent (initialView) wins, so clicking
  // a specific file always shows its working diff and opening a clean tree
  // lands in the editable working view even if the last stored view was a
  // commit. Otherwise restore the last view for this repo, falling back to
  // working.
  const [view, setView] = useState<EditorView>(() => {
    if (initialView) return initialView;
    return readStoredView(cwd) ?? { kind: 'working', ref: initialStaged ? 'index' : 'HEAD' };
  });
  const [selectedPath, setSelectedPath] = useState<string>(initialFilePath);
  // One-shot guard: a restored commit/branch ref may no longer exist (branch
  // deleted, history rewritten). Validate the *initial* view once and fall back
  // to working if it's stale — without ejecting the user from later choices.
  const validatedInitialView = useRef(false);

  // ── View-dependent git data (changed files, repo tree, commits, base) ──
  const workingFiles: FileChange[] = useMemo(() => gitStatus?.files ?? [], [gitStatus]);
  const {
    changedFiles,
    changedFilesLoading,
    repoPaths,
    repoPathsLoading,
    commits,
    commitsLoading,
    defaultBase,
  } = useEditorViewData(cwd, view, workingFiles);

  // Persist the active view per-repo so reopening lands back here.
  useEffect(() => {
    writeStoredView(cwd, view);
  }, [cwd, view]);
  useEffect(() => {
    writeStoredFile(cwd, selectedPath);
  }, [cwd, selectedPath]);

  // Validate the restored initial view exactly once. A commit lists every file
  // in its tree, so an empty repoPaths after load means the sha is gone; a
  // branch base is checked against the live branch list. Either miss → working.
  useEffect(() => {
    if (validatedInitialView.current) return;
    if (view.kind === 'working') {
      validatedInitialView.current = true;
      return;
    }
    if (view.kind === 'commit' || view.kind === 'pr') {
      if (repoPathsLoading) return; // wait for the tree listing to settle
      validatedInitialView.current = true;
      if (repoPaths.length === 0) changeView({ kind: 'working', ref: 'HEAD' });
      return;
    }
    // branch
    validatedInitialView.current = true;
    const base = view.base;
    void window.electronAPI.gitListBranches(cwd).then((resp) => {
      const exists = resp.success && !!resp.data?.some((b) => b.ref === base);
      if (!exists) changeView({ kind: 'working', ref: 'HEAD' });
    });
  }, [view, repoPaths, repoPathsLoading, cwd]);

  // Auto-pick the first changed file ONLY when nothing is selected. User
  // clicks must stay sticky — even on an unchanged file. Resetting on every
  // changedFiles update would snap the selection back on each git refresh
  // and lock the user out of the rest of the repo tree.
  useEffect(() => {
    if (selectedPath !== '') return;
    const first = pickFirstChangedFile(changedFiles);
    if (first) setSelectedPath(first);
  }, [selectedPath, changedFiles]);

  // Switching commits/working should restart "first changed file" selection.
  // Passing this to the sidebar instead of raw setView keeps the auto-pick
  // logic in one place.
  function changeView(next: EditorView) {
    setSelectedPath('');
    setView(next);
  }

  function selectBase(base: string) {
    changeView({ kind: 'branch', base });
  }

  function exitBranchView() {
    changeView({ kind: 'working', ref: 'HEAD' });
  }

  // ── Comments store ──────────────────────────────────────
  // Task-scoped, persisted to SQLite. Survives modal close/reopen. When
  // activeTaskId is null the store is `disabled` and all mutators no-op.
  const commentsByFile = useCommentsStore((s) => s.byFile);
  useEffect(() => {
    void useCommentsStore.getState().loadForTask(activeTaskId);
  }, [activeTaskId]);

  // Cross-file navigation token from the dropdown: when set, the EditorPane
  // switches to the requested file and reveals the comment with this id
  // once hydration completes, then clears it via onClearReveal.
  const [revealCommentId, setRevealCommentId] = useState<string | null>(null);

  const clearReveal = useCallback(() => setRevealCommentId(null), []);

  // File-tree badges reflect only the open view's scope, so a file never shows
  // "3 comments" when the diff you're looking at has none of them. Already-sent
  // comments don't need attention, so they're excluded from the count.
  const currentScope = commentScope(view);
  // ── The task's open PR and its review threads ────
  const openPr = useGit((s) => {
    const pr = activeTaskId ? s.prByTask[activeTaskId]?.[0] : undefined;
    return pr && pr.state === 'open' ? pr : null;
  });
  // The open view's PR review, or the task's own PR's when that was fetched.
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
      setSelectedPath('');
      setView({ kind: 'pr', provider, number, base, head });
      return true;
    },
    [projectId, cwd],
  );
  // Jump to a comment from the menu: switch to its view (scope) if needed,
  // select the file, and let EditorPane reveal it once it hydrates. A 'live'
  // comment stays in the current live view (working OR branch); a commit or PR
  // comment forces a view change (and a live comment pulls us off either).
  const navigateToComment = useCallback(
    async (scope: string, path: string, commentId: string) => {
      const pr = parsePrScope(scope);
      if (pr) {
        const here = view.kind === 'pr' && view.number === pr.number;
        if (!here && !(await openPrView(pr.number))) return;
      } else if (scope.startsWith('commit:')) {
        setView({ kind: 'commit', hash: scope.slice(7) });
      } else {
        setView((cur) =>
          cur.kind === 'commit' || cur.kind === 'pr' ? { kind: 'working', ref: 'HEAD' } : cur,
        );
      }
      setSelectedPath(path);
      setRevealCommentId(commentId);
    },
    [view, openPrView],
  );

  // A PR view restored from an earlier session has no review loaded yet: fetch
  // it (the PR may have moved on since), or fall back to the working tree.
  useEffect(() => {
    if (view.kind !== 'pr' || viewReview || !projectId) return;
    let cancelled = false;
    void usePrReviews
      .getState()
      .load(projectId, cwd, view.number)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          toast.error(`Could not load PR #${view.number}: ${r.error}`);
          changeView({ kind: 'working', ref: 'HEAD' });
        } else if (r.review.base !== view.base || r.review.head !== view.head) {
          setView({ ...view, base: r.review.base, head: r.review.head });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, viewReview, projectId, cwd]);

  const ownTaskReview = useTaskReview(activeTaskId, openPr);
  const prEntry: PrEntry | null = openPr
    ? {
        number: openPr.number,
        title: openPr.title,
        body: ownReview?.body ?? null,
        threads: ownReview ? unresolvedThreads(ownReview).length : null,
        inReview: ownTaskReview.inReview,
        onOpen: () => void openPrView(openPr.number),
        onReview: () => {
          ownTaskReview.setInReview(true);
          void openPrView(openPr.number);
        },
        onPeek: () => {
          if (!ownReview && projectId)
            void usePrReviews.getState().load(projectId, cwd, openPr.number);
        },
      }
    : null;

  // Your notes and comments, and in a PR view its unresolved threads too.
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

  // Per-view totals for the commits-drawer badges (all scopes, not just open).
  const commentCountByScope = useMemo(() => commentCountsByScope(commentsByFile), [commentsByFile]);

  // Once the working tree's file list is known, hard-delete any persisted
  // comments whose path no longer exists. Runs once per modal session per
  // task — the deps trigger a re-run if either changes mid-modal (rare).
  useEffect(() => {
    if (!activeTaskId) return;
    if (repoPathsLoading) return;
    if (repoPaths.length === 0) return;
    void useCommentsStore.getState().prune(new Set(repoPaths));
  }, [activeTaskId, repoPaths, repoPathsLoading]);

  const bg = terminalTheme.background ?? (isDark ? '#0d0d11' : '#faf8f3');

  return (
    <div className="h-full w-full overflow-hidden" style={{ background: bg }}>
      <PanelGroup direction="horizontal" autoSaveId="diff-editor-shell" className="h-full">
        <Panel defaultSize={22} minSize={14} maxSize={45}>
          <EditorSidebar
            cwd={cwd}
            allPaths={repoPaths}
            changedFiles={changedFiles}
            filesLoading={repoPathsLoading || changedFilesLoading}
            selectedPath={selectedPath}
            onSelectFile={setSelectedPath}
            badgeCounts={badgeCounts}
            commits={commits}
            commitsLoading={commitsLoading}
            commentCountByScope={commentCountByScope}
            view={view}
            onSelectView={changeView}
            pr={prEntry}
          />
        </Panel>
        <PanelResizeHandle className="w-3 bg-transparent hover:bg-transparent transition-colors" />
        <Panel minSize={40}>
          <EditorPane
            cwd={cwd}
            filePath={selectedPath}
            view={view}
            activeTaskId={activeTaskId}
            terminalTheme={terminalTheme}
            isDark={isDark}
            revealCommentId={revealCommentId}
            onNavigateToComment={(scope, path, id) => void navigateToComment(scope, path, id)}
            onClearReveal={clearReveal}
            onClose={onClose}
            onSelectBase={selectBase}
            onExitBranchView={exitBranchView}
            defaultBase={defaultBase}
            projectId={projectId}
            onSelectPr={openPrView}
            onSelectFile={setSelectedPath}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
