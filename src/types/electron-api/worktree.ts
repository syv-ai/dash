import type {
  IpcResponse,
  WorktreeMigrationProject,
  WorktreeMigrationResult,
} from '../../shared/types';
import type { SetupLog, SetupRun } from '../../shared/setupRuns';

/** Moving pre-0.16 worktrees to the current layout (a task's own worktree goes through task IPC),
 *  and the worktree setup script runs. */
export interface WorktreeApi {
  /** Tasks whose worktree still sits at the pre-0.16 `<parent>/worktrees/` location. */
  worktreeMigrationPlan: () => Promise<IpcResponse<WorktreeMigrationProject[]>>;
  /** `git worktree move` every legacy task of one project under `<repo>/.claude/worktrees/`. */
  worktreeMigrate: (args: {
    projectId: string;
    /** Delete tasks whose legacy directory is no longer a git worktree. */
    removeStale?: boolean;
  }) => Promise<IpcResponse<WorktreeMigrationResult>>;

  /** Every worktree setup run since launch (latest per worktree path). */
  worktreeSetupList: () => Promise<IpcResponse<SetupRun[]>>;
  /** A run's captured output (the last ~1 MB); null when there is no run. */
  worktreeSetupLog: (worktreePath: string) => Promise<IpcResponse<SetupLog | null>>;
  /** Run the task's setup again in its worktree. Fails while one is running. */
  worktreeSetupRerun: (taskId: string) => Promise<IpcResponse<void>>;
  /** A run started or ended. */
  onWorktreeSetupChanged: (callback: (run: SetupRun) => void) => () => void;
  /** New output from a running setup (batched). */
  onWorktreeSetupOutput: (
    callback: (data: { worktreePath: string; chunk: string }) => void,
  ) => () => void;
}
