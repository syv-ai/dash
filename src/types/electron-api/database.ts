import type {
  CreateTaskInput,
  CreateTaskResult,
  DeleteTaskOptions,
  SetTaskDashAccessInput,
  IpcResponse,
  Project,
  Task,
  Conversation,
  TokenStatsRollup,
} from '../../shared/types';

export interface TokenStatsUpdate {
  taskId: string;
  totalTokens: number;
  totalCostUsd: number;
}

/** SQLite-backed records (projects → tasks → conversations) and token-stat rollups. */
export interface DatabaseApi {
  // Projects
  getProjects: () => Promise<IpcResponse<Project[]>>;
  saveProject: (
    project: Partial<Project> & { name: string; path: string },
  ) => Promise<IpcResponse<Project>>;
  /** Deletes every task as `deleteTask` does (options apply to each), then the project. */
  deleteProject: (id: string, options: DeleteTaskOptions) => Promise<IpcResponse<void>>;
  archiveProject: (id: string) => Promise<IpcResponse<void>>;
  restoreProject: (id: string) => Promise<IpcResponse<void>>;

  // Tasks
  getTasks: (projectId: string) => Promise<IpcResponse<Task[]>>;
  saveTask: (
    task: Partial<Task> & { projectId: string; name: string; branch: string; path: string },
  ) => Promise<IpcResponse<Task>>;
  /** Create a task through main's TaskService (worktree, row, ports, first prompt). */
  createTask: (input: CreateTaskInput) => Promise<IpcResponse<CreateTaskResult>>;
  deleteTask: (id: string, options?: DeleteTaskOptions) => Promise<IpcResponse<void>>;
  setTaskScripts: (args: {
    id: string;
    setupScript: string | null;
    teardownScript: string | null;
  }) => Promise<IpcResponse<Task>>;
  archiveTask: (id: string) => Promise<IpcResponse<void>>;
  restoreTask: (id: string) => Promise<IpcResponse<void>>;
  /** Turn a task's Dash access on or off; returns the updated task. Applies at its next dispatch. */
  setTaskDashAccess: (input: SetTaskDashAccessInput) => Promise<IpcResponse<Task>>;
  reorderTasks: (projectId: string, orderedTaskIds: string[]) => Promise<IpcResponse<void>>;
  /** A project's tasks changed in main (created, archived, restored, deleted). */
  onTasksChanged: (callback: (data: { projectId: string }) => void) => () => void;

  // Conversations
  getConversations: (taskId: string) => Promise<IpcResponse<Conversation[]>>;
  getOrCreateDefaultConversation: (taskId: string) => Promise<IpcResponse<Conversation>>;

  // Token stats
  getProjectTokenStats: (projectId: string) => Promise<IpcResponse<TokenStatsRollup>>;
  getGlobalTokenStats: () => Promise<IpcResponse<TokenStatsRollup>>;
  onTokenStatsUpdated: (callback: (data: TokenStatsUpdate) => void) => () => void;
}
