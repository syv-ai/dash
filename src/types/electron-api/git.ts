import type {
  IpcResponse,
  GitStatus,
  DiffResult,
  BranchInfo,
  CommitGraphData,
  CommitDetail,
} from '../../shared/types';

/** Git + Claude detection and all git operations: status/diff, staging, commit
 *  (with live hook events), push, branches, commit graph, and the file watcher. */
export interface GitApi {
  // Detection
  detectGit: (
    folderPath: string,
  ) => Promise<IpcResponse<{ isGitRepo: boolean; remote: string | null; branch: string | null }>>;
  gitInit: (folderPath: string) => Promise<IpcResponse<null>>;
  detectClaude: () => Promise<
    IpcResponse<{ installed: boolean; version: string | null; path: string | null }>
  >;

  // Operations
  gitClone: (args: { url: string }) => Promise<IpcResponse<{ path: string; name: string }>>;
  gitGetStatus: (cwd: string) => Promise<IpcResponse<GitStatus>>;
  gitGetDiff: (args: {
    cwd: string;
    filePath?: string;
    staged?: boolean;
    contextLines?: number;
  }) => Promise<IpcResponse<DiffResult>>;
  gitGetDiffUntracked: (args: {
    cwd: string;
    filePath: string;
    contextLines?: number;
  }) => Promise<IpcResponse<DiffResult>>;
  gitStageFiles: (args: { cwd: string; filePaths: string[] }) => Promise<IpcResponse<void>>;
  gitStageAll: (cwd: string) => Promise<IpcResponse<void>>;
  gitUnstageFiles: (args: { cwd: string; filePaths: string[] }) => Promise<IpcResponse<void>>;
  gitUnstageAll: (cwd: string) => Promise<IpcResponse<void>>;
  gitDiscardFiles: (args: { cwd: string; filePaths: string[] }) => Promise<IpcResponse<void>>;
  gitignoreAdd: (args: { cwd: string; filePath: string }) => Promise<IpcResponse<void>>;
  gitCommit: (args: {
    cwd: string;
    message: string;
    allowEmpty?: boolean;
  }) => Promise<IpcResponse<void>>;
  gitCommitStart: (args: {
    cwd: string;
    message: string;
    allowEmpty?: boolean;
  }) => Promise<IpcResponse<{ requestId: string }>>;
  gitCommitCancel: (requestId: string) => Promise<IpcResponse<void>>;
  onCommitEvent: (
    cb: (msg: {
      requestId: string;
      event:
        | { type: 'hookResult'; name: string; status: 'Passed' | 'Failed' | 'Skipped' }
        | {
            type: 'hookMeta';
            key: 'id' | 'exit' | 'duration' | 'modified';
            value: string | number | true;
          }
        | { type: 'hookDiagnostic'; text: string }
        | { type: 'rawOutput'; text: string }
        | { type: 'close'; exitCode: number | null; signal: NodeJS.Signals | null };
    }) => void,
  ) => () => void;
  gitPush: (cwd: string) => Promise<IpcResponse<void>>;
  gitRemoteBranchExists: (args: { cwd: string; branch: string }) => Promise<IpcResponse<boolean>>;
  gitCheckoutBranch: (args: { cwd: string; branch: string }) => Promise<IpcResponse<void>>;
  gitUpdateBranchToRemote: (args: { cwd: string; branch: string }) => Promise<IpcResponse<void>>;

  // Commit graph
  gitGetCommitGraph: (args: {
    cwd: string;
    limit?: number;
    skip?: number;
  }) => Promise<IpcResponse<CommitGraphData>>;
  gitGetCommitDetail: (args: { cwd: string; hash: string }) => Promise<IpcResponse<CommitDetail>>;

  // Branch listing
  gitListBranches: (cwd: string) => Promise<IpcResponse<BranchInfo[]>>;

  // File watcher
  gitWatch: (args: { id: string; cwd: string }) => Promise<IpcResponse<void>>;
  gitUnwatch: (id: string) => Promise<IpcResponse<void>>;
  onGitFileChanged: (callback: (id: string) => void) => () => void;
}
