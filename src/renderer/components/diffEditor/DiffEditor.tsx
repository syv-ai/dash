import { useEffect, useMemo, useState } from 'react';
import type { ITheme as XtermTheme } from 'xterm';
import { Modal } from '../ui/Modal';
import type { FileChange, GitStatus } from '../../../shared/types';
import { EditorSidebar } from './EditorSidebar';
import { EditorPane } from './EditorPane';
import type { CommitSummary, EditorView } from './types';

interface DiffEditorProps {
  cwd: string;
  /** File the user clicked, or '' to let the editor pick the first file in the view. */
  initialFilePath: string;
  /** Whether the clicked file was the staged version. Used only when initialView is omitted. */
  initialStaged: boolean;
  /** Initial view. Defaults to working tree at HEAD/index. Pass `{kind:'commit', hash:'HEAD'}` to
   *  open at the latest commit (the editor resolves the sentinel once commits load). */
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

  // ── Files for the current view ──────────────────────────
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
        if (resp.success && resp.data) {
          setCommitFiles(resp.data);
          // If the current selection is not in this commit, jump to the first.
          if (resp.data.length > 0 && !resp.data.some((f) => f.path === selectedPath)) {
            setSelectedPath(resp.data[0].path);
          }
        } else {
          setCommitFiles([]);
        }
      })
      .finally(() => !cancelled && setCommitFilesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, cwd]);

  const workingFiles: FileChange[] = useMemo(() => gitStatus?.files ?? [], [gitStatus]);
  const files = view.kind === 'working' ? workingFiles : commitFiles;
  const filesLoading = view.kind === 'commit' ? commitFilesLoading : false;

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

  // When the view changes to working, ensure the selected file still exists in the working tree.
  // selectedPath intentionally omitted from deps so user clicks don't trigger reselection.
  useEffect(() => {
    if (view.kind !== 'working') return;
    if (files.length === 0) return;
    setSelectedPath((cur) => (files.some((f) => f.path === cur) ? cur : files[0].path));
  }, [view.kind, files]);

  return (
    <div className="flex h-full min-h-0">
      <EditorSidebar
        files={files}
        filesLoading={filesLoading}
        selectedPath={selectedPath}
        onSelectFile={setSelectedPath}
        commits={commits}
        commitsLoading={commitsLoading}
        view={view}
        onSelectView={setView}
      />
      <EditorPane
        cwd={cwd}
        filePath={selectedPath}
        view={view}
        activeTaskId={activeTaskId}
        terminalTheme={terminalTheme}
        isDark={isDark}
        onClose={onClose}
      />
    </div>
  );
}

export default DiffEditor;
