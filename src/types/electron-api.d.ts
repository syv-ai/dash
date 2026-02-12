import type {
  IpcResponse,
  Project,
  Task,
  Conversation,
  WorktreeInfo,
  TerminalSnapshot,
  GitStatus,
  DiffResult,
  BranchInfo,
} from '../shared/types';

export interface ElectronAPI {
  // App
  getAppVersion: () => Promise<string>;
  getPlatform: () => string;

  // Dialogs
  showOpenDialog: () => Promise<IpcResponse<string[]>>;

  // Database - Projects
  getProjects: () => Promise<IpcResponse<Project[]>>;
  saveProject: (
    project: Partial<Project> & { name: string; path: string },
  ) => Promise<IpcResponse<Project>>;
  deleteProject: (id: string) => Promise<IpcResponse<void>>;

  // Database - Tasks
  getTasks: (projectId: string) => Promise<IpcResponse<Task[]>>;
  saveTask: (
    task: Partial<Task> & { projectId: string; name: string; branch: string; path: string },
  ) => Promise<IpcResponse<Task>>;
  deleteTask: (id: string) => Promise<IpcResponse<void>>;
  archiveTask: (id: string) => Promise<IpcResponse<void>>;
  restoreTask: (id: string) => Promise<IpcResponse<void>>;

  // Database - Conversations
  getConversations: (taskId: string) => Promise<IpcResponse<Conversation[]>>;
  getOrCreateDefaultConversation: (taskId: string) => Promise<IpcResponse<Conversation>>;

  // Worktree
  worktreeCreate: (args: {
    projectPath: string;
    taskName: string;
    baseRef?: string;
    projectId: string;
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeRemove: (args: {
    projectPath: string;
    worktreePath: string;
    branch: string;
  }) => Promise<IpcResponse<void>>;
  worktreeClaimReserve: (args: {
    projectId: string;
    taskName: string;
    baseRef?: string;
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeEnsureReserve: (args: {
    projectId: string;
    projectPath: string;
  }) => Promise<IpcResponse<void>>;
  worktreeHasReserve: (projectId: string) => Promise<IpcResponse<boolean>>;

  // PTY
  ptyStartDirect: (args: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
    autoApprove?: boolean;
    resume?: boolean;
    isDark?: boolean;
  }) => Promise<IpcResponse<{ reattached: boolean; isDirectSpawn: boolean }>>;
  ptyStart: (args: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
  }) => Promise<IpcResponse<{ reattached: boolean; isDirectSpawn: boolean }>>;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows: number }) => void;
  ptyKill: (id: string) => void;
  onPtyData: (id: string, callback: (data: string) => void) => () => void;
  onPtyExit: (
    id: string,
    callback: (info: { exitCode: number; signal?: number }) => void,
  ) => () => void;

  // Activity monitor
  ptyGetAllActivity: () => Promise<IpcResponse<Record<string, 'busy' | 'idle'>>>;
  onPtyActivity: (callback: (data: Record<string, 'busy' | 'idle'>) => void) => () => void;

  // Snapshots
  ptyGetSnapshot: (id: string) => Promise<IpcResponse<TerminalSnapshot | null>>;
  ptySaveSnapshot: (id: string, payload: TerminalSnapshot) => void;
  ptyClearSnapshot: (id: string) => Promise<IpcResponse<void>>;

  // Session detection
  ptyHasClaudeSession: (cwd: string) => Promise<IpcResponse<boolean>>;

  // App lifecycle
  onBeforeQuit: (callback: () => void) => () => void;

  // Settings
  setDesktopNotification: (opts: { enabled: boolean; message: string }) => void;

  // Git detection
  detectGit: (
    folderPath: string,
  ) => Promise<IpcResponse<{ remote: string | null; branch: string | null }>>;
  detectClaude: () => Promise<
    IpcResponse<{ installed: boolean; version: string | null; path: string | null }>
  >;

  // Git operations
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
  gitStageFile: (args: { cwd: string; filePath: string }) => Promise<IpcResponse<void>>;
  gitStageAll: (cwd: string) => Promise<IpcResponse<void>>;
  gitUnstageFile: (args: { cwd: string; filePath: string }) => Promise<IpcResponse<void>>;
  gitUnstageAll: (cwd: string) => Promise<IpcResponse<void>>;
  gitDiscardFile: (args: { cwd: string; filePath: string }) => Promise<IpcResponse<void>>;
  gitCommit: (args: { cwd: string; message: string }) => Promise<IpcResponse<void>>;
  gitPush: (cwd: string) => Promise<IpcResponse<void>>;

  // Branch listing
  gitListBranches: (cwd: string) => Promise<IpcResponse<BranchInfo[]>>;

  // File watcher
  gitWatch: (args: { id: string; cwd: string }) => Promise<IpcResponse<void>>;
  gitUnwatch: (id: string) => Promise<IpcResponse<void>>;
  onGitFileChanged: (callback: (id: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
