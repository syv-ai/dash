import type { IpcResponse, WorktreeInfo } from '../../shared/types';

/** Git worktree lifecycle — one worktree per task, plus the pre-warmed reserve pool. */
export interface WorktreeApi {
  worktreeCreate: (args: {
    projectPath: string;
    taskName: string;
    baseRef?: string;
    projectId: string;
    linkedIssueNumbers?: number[];
    pushRemote?: boolean;
    setupScript?: string | null;
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeRemove: (args: {
    projectPath: string;
    worktreePath: string;
    branch: string;
    options?: {
      deleteWorktreeDir?: boolean;
      deleteLocalBranch?: boolean;
      deleteRemoteBranch?: boolean;
      teardownScript?: string | null;
    };
  }) => Promise<IpcResponse<void>>;
  worktreeClaimReserve: (args: {
    projectId: string;
    taskName: string;
    baseRef?: string;
    linkedIssueNumbers?: number[];
    pushRemote?: boolean;
    setupScript?: string | null;
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeCreateFromExisting: (args: {
    projectPath: string;
    taskName: string;
    branch: string;
    projectId: string;
    linkedIssueNumbers?: number[];
    setupScript?: string | null;
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeEnsureReserve: (args: {
    projectId: string;
    projectPath: string;
  }) => Promise<IpcResponse<void>>;
  worktreeHasReserve: (projectId: string) => Promise<IpcResponse<boolean>>;
}
