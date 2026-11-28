import type {
  DirEntry,
  RepoListing,
  IpcResponse,
  EditorReadWorkingResult,
  PreviewImage,
  EditorReadCommitResult,
  EditorReadBranchResult,
  EditorWriteResult,
  EditorCommitListItem,
  EditorBlameResult,
  FileChange,
  DiffComment,
  DiffCommentInput,
} from '../../shared/types';

/** The diff editor: read/write working files and browse commits through the main
 *  process, plus the per-task review comments attached to diffs. */
export interface EditorApi {
  editorReadWorking: (args: {
    cwd: string;
    filePath: string;
    ref: 'HEAD' | 'index';
  }) => Promise<IpcResponse<EditorReadWorkingResult>>;
  /** A file at `hash` against its parent, or against `base` when given (a PR's merge-base). */
  editorReadCommit: (args: {
    cwd: string;
    filePath: string;
    hash: string;
    base?: string;
  }) => Promise<IpcResponse<EditorReadCommitResult>>;
  editorWriteWorking: (args: {
    cwd: string;
    filePath: string;
    content: string;
    expectedMtimeMs: number;
    expectedSizeBytes: number;
  }) => Promise<IpcResponse<EditorWriteResult>>;
  editorListCommits: (args: {
    cwd: string;
    limit?: number;
    /** The commits of `base..head` (two shas: a PR's) instead of HEAD's history. */
    range?: { base: string; head: string };
  }) => Promise<IpcResponse<EditorCommitListItem[]>>;
  editorListFilesInCommit: (args: {
    cwd: string;
    hash: string;
    base?: string;
  }) => Promise<IpcResponse<FileChange[]>>;
  editorListRepoFiles: (args: {
    cwd: string;
    source: { kind: 'working' } | { kind: 'commit'; hash: string };
  }) => Promise<IpcResponse<RepoListing>>;
  /** One directory's entries, for a folder the tree lists lazily. */
  editorListDir: (args: { cwd: string; dirPath: string }) => Promise<IpcResponse<DirEntry[]>>;
  /** Watch `cwd`'s files while the all-files tree shows them (ref-counted:
   *  pair each call with `editorUnwatchTree`). */
  editorWatchTree: (args: { cwd: string }) => Promise<IpcResponse<void>>;
  editorUnwatchTree: (args: { cwd: string }) => Promise<IpcResponse<void>>;
  /** A file or folder under a watched `cwd` came, went or was renamed. */
  onEditorTreeChanged: (callback: (event: { cwd: string }) => void) => () => void;
  /** The images a rendered preview names, each `paths` entry resolved from the
   *  document's folder (repo-relative, or absolute in a task's outside
   *  folder), as `data:` URIs or refusals, in order (`previewImages.ts`). */
  editorReadImages: (args: {
    cwd: string;
    paths: string[];
  }) => Promise<IpcResponse<PreviewImage[]>>;
  /** A file's text at `base` (left) and on disk (right): a live PR view. */
  editorReadAgainstBase: (args: {
    cwd: string;
    filePath: string;
    base: string;
  }) => Promise<IpcResponse<EditorReadBranchResult>>;
  editorBlame: (args: {
    cwd: string;
    filePath: string;
    ref: string | null;
  }) => Promise<IpcResponse<EditorBlameResult>>;

  // Diff review comments
  diffCommentsList: (args: { taskId: string }) => Promise<IpcResponse<DiffComment[]>>;
  diffCommentsUpsert: (c: DiffCommentInput) => Promise<IpcResponse<DiffComment>>;
  diffCommentsDelete: (args: { id: string }) => Promise<IpcResponse<void>>;
  diffCommentsPruneForTask: (args: {
    taskId: string;
    existingFilePaths: string[];
  }) => Promise<IpcResponse<{ deleted: number }>>;
}
