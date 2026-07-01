import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { FileChange } from '../../../shared/types';
import { useGit } from '../../stores/gitStore';
import { EditorSidebar } from './EditorSidebar';
import { EditorPane } from './EditorPane';
import type { EditorView } from './types';
import type { DiffEditorModalProps } from './DiffEditorModal';
import { useEditorViewData } from './data/useEditorViewData';
import { resolveHeadSentinel, pickFirstChangedFile } from './data/viewData';
import { readStoredView, writeStoredView } from './data/viewPersistence';
import { useCommentsStore } from '../../stores/commentsStore';
import { commentScope, commentCountsByScope } from './comments/commentScope';

/** Composition-root workspace: owns view state, drives the data loaders, and
 *  lays out the sidebar + editor pane. Rendered inside <DiffEditorModal>. */
export function DiffEditor({
  cwd,
  initialFilePath,
  initialStaged,
  initialView,
  activeTaskId,
  terminalTheme,
  isDark,
  onClose,
}: DiffEditorModalProps) {
  const gitStatus = useGit((s) => s.gitStatus);
  // View precedence: an explicit caller intent (initialView) wins, so clicking
  // a specific file always shows its working diff and "open at HEAD" is honored.
  // Otherwise restore the last view for this repo, falling back to working.
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

  // Resolve the 'HEAD' sentinel that callers can pass to mean "latest commit"
  // before they know its sha. Once commits arrive, swap to the concrete hash
  // so the drawer highlight matches.
  useEffect(() => {
    setView((current) => resolveHeadSentinel(current, commits));
  }, [commits]);

  // Persist the active view per-repo so reopening lands back here. The 'HEAD'
  // sentinel is skipped inside writeStoredView until it resolves to a sha.
  useEffect(() => {
    writeStoredView(cwd, view);
  }, [cwd, view]);

  // Validate the restored initial view exactly once. A commit lists every file
  // in its tree, so an empty repoPaths after load means the sha is gone; a
  // branch base is checked against the live branch list. Either miss → working.
  useEffect(() => {
    if (validatedInitialView.current) return;
    if (view.kind === 'working') {
      validatedInitialView.current = true;
      return;
    }
    if (view.kind === 'commit') {
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

  // Jump to a comment from the menu: switch to its view (scope) if needed,
  // select the file, and let EditorPane reveal it once it hydrates. A 'live'
  // comment stays in the current live view (working OR branch); only a commit
  // comment forces a view change (and a live comment pulls us off a commit).
  const navigateToComment = useCallback((scope: string, path: string, commentId: string) => {
    if (scope.startsWith('commit:')) {
      setView({ kind: 'commit', hash: scope.slice(7) });
    } else {
      setView((cur) => (cur.kind === 'commit' ? { kind: 'working', ref: 'HEAD' } : cur));
    }
    setSelectedPath(path);
    setRevealCommentId(commentId);
  }, []);

  const clearReveal = useCallback(() => setRevealCommentId(null), []);

  // File-tree badges reflect only the open view's scope, so a file never shows
  // "3 comments" when the diff you're looking at has none of them. Already-sent
  // comments don't need attention, so they're excluded from the count.
  const currentScope = commentScope(view);
  const commentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const [path, list] of Object.entries(commentsByFile)) {
      const n = list.filter((c) => c.viewScope === currentScope && !c.sent).length;
      if (n > 0) map.set(path, n);
    }
    return map;
  }, [commentsByFile, currentScope]);

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
            commentCounts={commentCounts}
            commits={commits}
            commitsLoading={commitsLoading}
            showWorkingTreeRow={workingFiles.length > 0}
            commentCountByScope={commentCountByScope}
            view={view}
            onSelectView={changeView}
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
            onNavigateToComment={navigateToComment}
            onClearReveal={clearReveal}
            onClose={onClose}
            onSelectBase={selectBase}
            onExitBranchView={exitBranchView}
            defaultBase={defaultBase}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
