import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ITheme as XtermTheme } from 'xterm';
import { Modal } from '../ui/Modal';
import type { FileChange, GitStatus } from '../../../shared/types';
import { EditorSidebar } from './EditorSidebar';
import { EditorPane } from './EditorPane';
import type { CommitSummary, EditorView } from './types';
import { useCommentsStore } from './comments/useCommentsStore';
import { CommentsProvider } from './comments/CommentsContext';

interface DiffEditorProps {
  cwd: string;
  /** File the user clicked, or '' to let the editor pick the first file in the view. */
  initialFilePath: string;
  /** Whether the clicked file was the staged version. Used only when initialView is omitted. */
  initialStaged: boolean;
  /** Initial view. Defaults to working tree at HEAD/index. Pass `{kind:'commit', hash:'HEAD'}`
   *  to open at the latest commit (the editor resolves the sentinel once commits load). */
  initialView?: EditorView;
  /** Working-tree git status the project already has — seeds the sidebar without a round-trip. */
  gitStatus: GitStatus | null;
  activeTaskId: string | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  onClose: () => void;
}

export function DiffEditor(props: DiffEditorProps) {
  return (
    <Modal onClose={props.onClose} size="w-[96vw] max-w-7xl h-[88vh]">
      <DiffEditorBody {...props} />
    </Modal>
  );
}

function DiffEditorBody({
  cwd,
  initialFilePath,
  initialStaged,
  initialView,
  gitStatus,
  activeTaskId,
  terminalTheme,
  isDark,
  onClose,
}: DiffEditorProps) {
  const [view, setView] = useState<EditorView>(
    () => initialView ?? { kind: 'working', ref: initialStaged ? 'index' : 'HEAD' },
  );
  const [selectedPath, setSelectedPath] = useState<string>(initialFilePath);

  // ── Changed files in the current view ───────────────────
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([]);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);

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

  const workingFiles: FileChange[] = useMemo(() => gitStatus?.files ?? [], [gitStatus]);
  const changedFiles = view.kind === 'working' ? workingFiles : commitFiles;
  const changedFilesLoading = view.kind === 'commit' ? commitFilesLoading : false;

  // ── All repo paths for the current view (for the full tree) ───
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [repoPathsLoading, setRepoPathsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRepoPathsLoading(true);
    const source =
      view.kind === 'working'
        ? ({ kind: 'working' } as const)
        : ({ kind: 'commit', hash: view.hash } as const);
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
              return { kind: 'commit', hash: list[0].hash };
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
      if (workingFiles.length > 0) setSelectedPath(workingFiles[0].path);
    } else if (commitFiles.length > 0) {
      setSelectedPath(commitFiles[0].path);
    }
  }, [selectedPath, view.kind, workingFiles, commitFiles]);

  // Switching commits/working should restart "first changed file" selection.
  // Passing this to the sidebar instead of raw setView keeps the auto-pick
  // logic in one place.
  function changeView(next: EditorView) {
    setSelectedPath('');
    setView(next);
  }

  // ── Comments store ──────────────────────────────────────
  // Task-scoped, persisted to SQLite. Survives modal close/reopen. When
  // activeTaskId is null the store is `disabled` and all mutators no-op.
  const store = useCommentsStore(activeTaskId);

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
    for (const [path, list] of Object.entries(store.state.byFile)) {
      if (list.length > 0) map.set(path, list.length);
    }
    return map;
  }, [store.state.byFile]);

  // Once the working tree's file list is known, hard-delete any persisted
  // comments whose path no longer exists. Runs once per modal session per
  // task — the deps trigger a re-run if either changes mid-modal (rare).
  useEffect(() => {
    if (!activeTaskId) return;
    if (repoPathsLoading) return;
    if (repoPaths.length === 0) return;
    void store.prune(new Set(repoPaths));
  }, [activeTaskId, repoPaths, repoPathsLoading, store]);

  const bg = terminalTheme.background ?? (isDark ? '#0d0d11' : '#faf8f3');

  return (
    <div className="h-full w-full overflow-hidden" style={{ background: bg }}>
      <CommentsProvider value={store}>
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
            />
          </Panel>
        </PanelGroup>
      </CommentsProvider>
    </div>
  );
}

export default DiffEditor;
