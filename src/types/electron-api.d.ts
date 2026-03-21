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
  GithubIssue,
  AzureDevOpsWorkItem,
  AzureDevOpsConfig,
  CommitGraphData,
  CommitDetail,
  RemoteControlState,
  TaskContextMeta,
  PullRequestInfo,
  PixelAgentsConfig,
  PixelAgentsStatus,
} from '../shared/types';

export interface ElectronAPI {
  // App
  getAppVersion: () => Promise<string>;
  getPlatform: () => string;

  // Dialogs
  showOpenDialog: () => Promise<IpcResponse<string[]>>;
  openExternal: (url: string) => Promise<void>;
  openInEditor: (args: {
    cwd: string;
    filePath: string;
    line?: number;
    col?: number;
  }) => Promise<IpcResponse<null>>;
  openInIDE: (args: { folderPath: string; ide?: 'cursor' | 'code' }) => Promise<IpcResponse<null>>;
  detectAvailableIDEs: () => Promise<IpcResponse<string[]>>;

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
    linkedIssueNumbers?: number[];
    pushRemote?: boolean;
  }) => Promise<IpcResponse<WorktreeInfo>>;
  worktreeRemove: (args: {
    projectPath: string;
    worktreePath: string;
    branch: string;
    options?: {
      deleteWorktreeDir?: boolean;
      deleteLocalBranch?: boolean;
      deleteRemoteBranch?: boolean;
    };
  }) => Promise<IpcResponse<void>>;
  worktreeClaimReserve: (args: {
    projectId: string;
    taskName: string;
    baseRef?: string;
    linkedIssueNumbers?: number[];
    pushRemote?: boolean;
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
  }) => Promise<
    IpcResponse<{
      reattached: boolean;
      isDirectSpawn: boolean;
      hasTaskContext: boolean;
      taskContextMeta: TaskContextMeta | null;
    }>
  >;
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
  ptyGetAllActivity: () => Promise<IpcResponse<Record<string, 'busy' | 'idle' | 'waiting'>>>;
  onPtyActivity: (
    callback: (data: Record<string, 'busy' | 'idle' | 'waiting'>) => void,
  ) => () => void;

  // Remote control
  ptyRemoteControlEnable: (ptyId: string) => Promise<IpcResponse<void>>;
  ptyRemoteControlGetAllStates: () => Promise<IpcResponse<Record<string, RemoteControlState>>>;
  onRemoteControlStateChanged: (
    callback: (data: { ptyId: string; state: RemoteControlState | null }) => void,
  ) => () => void;

  // Snapshots
  ptyGetSnapshot: (id: string) => Promise<IpcResponse<TerminalSnapshot | null>>;
  ptySaveSnapshot: (id: string, payload: TerminalSnapshot) => void;
  ptyClearSnapshot: (id: string) => Promise<IpcResponse<void>>;

  // Session detection
  ptyHasClaudeSession: (cwd: string) => Promise<IpcResponse<boolean>>;

  // Task context for SessionStart hook
  ptyWriteTaskContext: (args: {
    cwd: string;
    prompt: string;
    meta?: TaskContextMeta;
  }) => Promise<IpcResponse<void>>;

  // App lifecycle
  onBeforeQuit: (callback: () => void) => () => void;
  onFocusTask: (callback: (taskId: string) => void) => () => void;
  onToast: (callback: (data: { message: string; url?: string }) => void) => () => void;

  // Settings
  setDesktopNotification: (opts: { enabled: boolean }) => void;
  setCommitAttribution: (value: string | undefined) => void;
  getClaudeAttribution: (projectPath?: string) => Promise<IpcResponse<string | null>>;

  // GitHub
  githubCheckAvailable: () => Promise<IpcResponse<boolean>>;
  githubSearchIssues: (cwd: string, query: string) => Promise<IpcResponse<GithubIssue[]>>;
  githubGetIssue: (cwd: string, number: number) => Promise<IpcResponse<GithubIssue>>;
  githubPostBranchComment: (
    cwd: string,
    issueNumber: number,
    branch: string,
  ) => Promise<IpcResponse<void>>;
  githubLinkBranch: (
    cwd: string,
    issueNumber: number,
    branch: string,
  ) => Promise<IpcResponse<void>>;
  githubGetPrForBranch: (
    cwd: string,
    branch: string,
  ) => Promise<IpcResponse<PullRequestInfo | null>>;

  // Azure DevOps
  adoCheckConfigured: (projectId?: string) => Promise<IpcResponse<boolean>>;
  adoTestConnection: (config: AzureDevOpsConfig) => Promise<IpcResponse<boolean>>;
  adoSaveConfig: (config: AzureDevOpsConfig, projectId?: string) => Promise<IpcResponse<void>>;
  adoGetConfig: (projectId?: string) => Promise<IpcResponse<AzureDevOpsConfig | null>>;
  adoRemoveConfig: (projectId?: string) => Promise<IpcResponse<void>>;
  adoSearchWorkItems: (
    query: string,
    projectId?: string,
  ) => Promise<IpcResponse<AzureDevOpsWorkItem[]>>;
  adoGetWorkItem: (id: number, projectId?: string) => Promise<IpcResponse<AzureDevOpsWorkItem>>;
  adoPostBranchComment: (
    workItemId: number,
    branch: string,
    projectId?: string,
  ) => Promise<IpcResponse<void>>;
  adoGetPrForBranch: (
    branch: string,
    gitRemote: string,
    projectId?: string,
  ) => Promise<IpcResponse<PullRequestInfo | null>>;

  // Git detection
  detectGit: (
    folderPath: string,
  ) => Promise<IpcResponse<{ isGitRepo: boolean; remote: string | null; branch: string | null }>>;
  gitInit: (folderPath: string) => Promise<IpcResponse<null>>;
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
  gitRemoteBranchExists: (args: { cwd: string; branch: string }) => Promise<IpcResponse<boolean>>;

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

  // Pixel Agents
  pixelAgentsGetConfig: () => Promise<IpcResponse<PixelAgentsConfig | null>>;
  pixelAgentsSaveConfig: (config: PixelAgentsConfig) => Promise<IpcResponse<void>>;
  pixelAgentsGetStatus: () => Promise<IpcResponse<PixelAgentsStatus>>;
  pixelAgentsStart: () => Promise<IpcResponse<void>>;
  pixelAgentsStop: () => Promise<IpcResponse<void>>;
  onPixelAgentsStatusChanged: (callback: (status: PixelAgentsStatus) => void) => () => void;

  // Telemetry
  telemetryCapture: (event: string, properties?: Record<string, unknown>) => Promise<void>;
  telemetryGetStatus: () => Promise<IpcResponse<{ enabled: boolean; envDisabled: boolean }>>;
  telemetrySetEnabled: (enabled: boolean) => Promise<IpcResponse<void>>;

  // Auto-update
  autoUpdateCheck: () => Promise<IpcResponse<void>>;
  autoUpdateDownload: () => Promise<IpcResponse<void>>;
  autoUpdateQuitAndInstall: () => Promise<IpcResponse<void>>;
  onAutoUpdateAvailable: (callback: (info: { version: string }) => void) => () => void;
  onAutoUpdateNotAvailable: (callback: () => void) => () => void;
  onAutoUpdateDownloadProgress: (
    callback: (progress: {
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }) => void,
  ) => () => void;
  onAutoUpdateDownloaded: (callback: () => void) => () => void;
  onAutoUpdateError: (callback: (info: { message: string; detail: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
