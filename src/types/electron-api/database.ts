import type {
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
  deleteProject: (id: string) => Promise<IpcResponse<void>>;

  // Tasks
  getTasks: (projectId: string) => Promise<IpcResponse<Task[]>>;
  saveTask: (
    task: Partial<Task> & { projectId: string; name: string; branch: string; path: string },
  ) => Promise<IpcResponse<Task>>;
  deleteTask: (id: string) => Promise<IpcResponse<void>>;
  setTaskScripts: (args: {
    id: string;
    setupScript: string | null;
    teardownScript: string | null;
  }) => Promise<IpcResponse<Task>>;
  archiveTask: (id: string) => Promise<IpcResponse<void>>;
  restoreTask: (id: string) => Promise<IpcResponse<void>>;
  reorderTasks: (projectId: string, orderedTaskIds: string[]) => Promise<IpcResponse<void>>;

  // Conversations
  getConversations: (taskId: string) => Promise<IpcResponse<Conversation[]>>;
  getOrCreateDefaultConversation: (taskId: string) => Promise<IpcResponse<Conversation>>;

  // Token stats
  getProjectTokenStats: (projectId: string) => Promise<IpcResponse<TokenStatsRollup>>;
  getGlobalTokenStats: () => Promise<IpcResponse<TokenStatsRollup>>;
  onTokenStatsUpdated: (callback: (data: TokenStatsUpdate) => void) => () => void;
}
