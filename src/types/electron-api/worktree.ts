import type {
  IpcResponse,
  WorktreeMigrationProject,
  WorktreeMigrationResult,
} from '../../shared/types';

/** Git worktree lifecycle — one worktree per task, plus the pre-warmed reserve pool. */
export interface WorktreeApi {
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
  worktreeEnsureReserve: (args: {
    projectId: string;
    projectPath: string;
  }) => Promise<IpcResponse<void>>;
  worktreeHasReserve: (projectId: string) => Promise<IpcResponse<boolean>>;
  /** Tasks whose worktree still sits at the pre-0.16 `<parent>/worktrees/` location. */
  worktreeMigrationPlan: () => Promise<IpcResponse<WorktreeMigrationProject[]>>;
  /** `git worktree move` every legacy task of one project under `<repo>/.claude/worktrees/`. */
  worktreeMigrate: (args: {
    projectId: string;
    /** Delete tasks whose legacy directory is no longer a git worktree. */
    removeStale?: boolean;
  }) => Promise<IpcResponse<WorktreeMigrationResult>>;
}
