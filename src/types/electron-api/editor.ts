import type {
  IpcResponse,
  EditorReadWorkingResult,
  EditorReadCommitResult,
  EditorReadBranchResult,
  EditorWriteResult,
  EditorCommitListItem,
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
  editorReadCommit: (args: {
    cwd: string;
    filePath: string;
    hash: string;
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
  }) => Promise<IpcResponse<EditorCommitListItem[]>>;
  editorListFilesInCommit: (args: {
    cwd: string;
    hash: string;
  }) => Promise<IpcResponse<FileChange[]>>;
  editorListRepoFiles: (args: {
    cwd: string;
    source: { kind: 'working' } | { kind: 'commit'; hash: string };
  }) => Promise<IpcResponse<string[]>>;
  editorResolveDefaultBase: (args: { cwd: string }) => Promise<IpcResponse<string | null>>;
  editorListFilesAgainstBase: (args: {
    cwd: string;
    base: string;
  }) => Promise<IpcResponse<FileChange[]>>;
  editorReadAgainstBase: (args: {
    cwd: string;
    filePath: string;
    base: string;
  }) => Promise<IpcResponse<EditorReadBranchResult>>;

  // Diff review comments
  diffCommentsList: (args: { taskId: string }) => Promise<IpcResponse<DiffComment[]>>;
  diffCommentsUpsert: (c: DiffCommentInput) => Promise<IpcResponse<DiffComment>>;
  diffCommentsDelete: (args: { id: string }) => Promise<IpcResponse<void>>;
  diffCommentsPruneForTask: (args: {
    taskId: string;
    existingFilePaths: string[];
  }) => Promise<IpcResponse<{ deleted: number }>>;
}
