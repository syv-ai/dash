import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { FileChange } from '../../../shared/types';
import { useGit } from '../../stores/gitStore';
import { EditorSidebar } from './EditorSidebar';
import { EditorPane } from './EditorPane';
import type { CommitSummary, EditorView } from './types';
import type { DiffEditorModalProps } from './DiffEditorModal';
import { useCommentsStore } from '../../stores/commentsStore';

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
  const [view, setView] = useState<EditorView>(
    () => initialView ?? { kind: 'working', ref: initialStaged ? 'index' : 'HEAD' },
  );
  const [selectedPath, setSelectedPath] = useState<string>(initialFilePath);

  // ── Changed files in the current view ───────────────────
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [branchFiles, setBranchFiles] = useState<FileChange[]>([]);
  const [branchFilesLoading, setBranchFilesLoading] = useState(false);

  useEffect(() => {
    if (view.kind !== 'commit') return;
    let cancelled = false;
    setCommitFilesLoading(true);
    void window.electronAPI
      .editorListFilesInCommit({ cwd, hash: view.hash })
      .then((resp) => {
        if (cancelled) return;
        setCommitFiles(resp.success && resp.data ? resp.data : []);
      })
      .finally(() => !cancelled && setCommitFilesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, cwd]);

  useEffect(() => {
    if (view.kind !== 'branch') return;
    let cancelled = false;
    setBranchFilesLoading(true);
    void window.electronAPI
      .editorListFilesAgainstBase({ cwd, base: view.base })
      .then((resp) => {
        if (cancelled) return;
        setBranchFiles(resp.success && resp.data ? resp.data : []);
      })
      .finally(() => !cancelled && setBranchFilesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, cwd]);

  const workingFiles: FileChange[] = useMemo(() => gitStatus?.files ?? [], [gitStatus]);
  const changedFiles =
    view.kind === 'working' ? workingFiles : view.kind === 'commit' ? commitFiles : branchFiles;
  const changedFilesLoading =
    view.kind === 'commit'
      ? commitFilesLoading
      : view.kind === 'branch'
        ? branchFilesLoading
        : false;

  // ── All repo paths for the current view (for the full tree) ───
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [repoPathsLoading, setRepoPathsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRepoPathsLoading(true);
    // Branch view: the right side IS the working tree, so the full file
    // tree comes from the working source — same as 'working' view.
    const source =
      view.kind === 'commit'
        ? ({ kind: 'commit', hash: view.hash } as const)
        : ({ kind: 'working' } as const);
    void window.electronAPI
      .editorListRepoFiles({ cwd, source })
      .then((resp) => {
        if (cancelled) return;
        if (resp.success && resp.data) {
          setRepoPaths(resp.data);
        } else {
          setRepoPaths([]);
        }
      })
      .finally(() => !cancelled && setRepoPathsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, cwd]);

  // ── Commits list ─────────────────────────────────────────
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCommitsLoading(true);
    void window.electronAPI
      .editorListCommits({ cwd, limit: 50 })
      .then((resp) => {
        if (cancelled) return;
        if (resp.success && resp.data) {
          const list = resp.data.map((c) => ({
            hash: c.hash,
            shortHash: c.shortHash,
            subject: c.subject,
            body: c.body,
            authorName: c.authorName,
            authorDate: c.authorDate,
          }));
          setCommits(list);
          // Resolve the 'HEAD' sentinel that callers can pass to mean "latest
          // commit" before they know its sha. Once we know it, swap to the
          // concrete hash so the drawer highlight matches.
          setView((current) => {
            if (current.kind === 'commit' && current.hash === 'HEAD' && list.length > 0) {
              return { kind: 'commit', hash: list[0]!.hash };
            }
            return current;
          });
        } else {
          setCommits([]);
        }
      })
      .finally(() => !cancelled && setCommitsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // Auto-pick the first changed file ONLY when nothing is selected. User
  // clicks must stay sticky — even on an unchanged file. Resetting on every
  // changedFiles update would snap the selection back on each git refresh
  // and lock the user out of the rest of the repo tree.
  useEffect(() => {
    if (selectedPath !== '') return;
    if (view.kind === 'working') {
      if (workingFiles.length > 0) setSelectedPath(workingFiles[0]!.path);
    } else if (view.kind === 'commit') {
      if (commitFiles.length > 0) setSelectedPath(commitFiles[0]!.path);
    } else if (view.kind === 'branch') {
      if (branchFiles.length > 0) setSelectedPath(branchFiles[0]!.path);
    }
  }, [selectedPath, view.kind, workingFiles, commitFiles, branchFiles]);

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

  // ── Default base branch ─────────────────────────────────
  // Resolved once per modal session. Shown in the header chip as the
  // resolved name (e.g. "origin/main") before the user has picked anything.
  // Null when the repo has no remote default and no local main/master.
  const [defaultBase, setDefaultBase] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.editorResolveDefaultBase({ cwd }).then((resp) => {
      if (cancelled) return;
      if (resp.success) setDefaultBase(resp.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

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

  const navigateAcrossFile = useCallback((path: string, commentId: string) => {
    setSelectedPath(path);
    setRevealCommentId(commentId);
  }, []);

  const clearReveal = useCallback(() => setRevealCommentId(null), []);

  const commentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const [path, list] of Object.entries(commentsByFile)) {
      if (list.length > 0) map.set(path, list.length);
    }
    return map;
  }, [commentsByFile]);

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
            allPaths={repoPaths}
            changedFiles={changedFiles}
            filesLoading={repoPathsLoading || changedFilesLoading}
            selectedPath={selectedPath}
            onSelectFile={setSelectedPath}
            commentCounts={commentCounts}
            commits={commits}
            commitsLoading={commitsLoading}
            showWorkingTreeRow={workingFiles.length > 0}
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
            onNavigateAcrossFile={navigateAcrossFile}
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
