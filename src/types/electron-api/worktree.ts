import type {
  IpcResponse,
  WorktreeMigrationProject,
  WorktreeMigrationResult,
} from '../../shared/types';

/** Moving pre-0.16 worktrees to the current layout (a task's own worktree goes through task IPC). */
export interface WorktreeApi {
  /** Tasks whose worktree still sits at the pre-0.16 `<parent>/worktrees/` location. */
  worktreeMigrationPlan: () => Promise<IpcResponse<WorktreeMigrationProject[]>>;
  /** `git worktree move` every legacy task of one project under `<repo>/.claude/worktrees/`. */
  worktreeMigrate: (args: {
    projectId: string;
    /** Delete tasks whose legacy directory is no longer a git worktree. */
    removeStale?: boolean;
  }) => Promise<IpcResponse<WorktreeMigrationResult>>;
}
