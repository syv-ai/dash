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
  StatusLineData,
  RemoteControlState,
  PullRequestInfo,
  ActivityInfo,
  RtkStatus,
  RtkDownloadProgress,
  RtkTestResult,
  SkillsSearchResult,
  SkillInstallStatus,
  SkillRef,
  SkillInstallArgs,
  SkillInstallTarget,
  SkillUninstallArgs,
  SkillsSearchArgs,
  SkillsRegistryMeta,
  InstalledSkillsResult,
  EditorReadWorkingResult,
  EditorReadCommitResult,
  EditorWriteResult,
  EditorCommitListItem,
  FileChange,
} from '../shared/types';
import type { ParsedSessionMessage, SessionMetrics, SessionUpdate } from '../shared/sessionTypes';

export interface ElectronAPI {
  // App
  getAppVersion: () => Promise<string>;
  getPlatform: () => string;

  // Dialogs
  showOpenDialog: () => Promise<IpcResponse<string[]>>;
  openExternal: (url: string) => Promise<void>;
  clipboardWriteText: (text: string) => void;
  clipboardReadText: () => Promise<string>;
  openInEditor: (args: {
    cwd: string;
    filePath: string;
    line?: number;
    col?: number;
  }) => Promise<IpcResponse<null>>;
  openInIDE: (args: {
    folderPath: string;
    ide?: string;
    customCommand?: { path: string; args: string[] };
  }) => Promise<IpcResponse<null>>;
  detectAvailableIDEs: () => Promise<IpcResponse<Array<{ id: string; label: string }>>>;
  pickExecutable: () => Promise<IpcResponse<string | null>>;

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
  reorderTasks: (projectId: string, orderedTaskIds: string[]) => Promise<IpcResponse<void>>;

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
  worktreeCreateFromExisting: (args: {
    projectPath: string;
    taskName: string;
    branch: string;
    projectId: string;
    linkedIssueNumbers?: number[];
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
    isDark?: boolean;
  }) => Promise<
    IpcResponse<{
      reattached: boolean;
      isDirectSpawn: boolean;
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
  ptyGetAllActivity: () => Promise<IpcResponse<Record<string, ActivityInfo>>>;
  onPtyActivity: (callback: (data: Record<string, ActivityInfo>) => void) => () => void;

  // Remote control
  ptyRemoteControlEnable: (ptyId: string) => Promise<IpcResponse<void>>;
  ptyRemoteControlGetAllStates: () => Promise<IpcResponse<Record<string, RemoteControlState>>>;
  onRemoteControlStateChanged: (
    callback: (data: { ptyId: string; state: RemoteControlState | null }) => void,
  ) => () => void;

  // Status line data (context + cost + rate limits)
  ptyGetAllStatusLine: () => Promise<IpcResponse<Record<string, StatusLineData>>>;
  onPtyStatusLine: (callback: (data: Record<string, StatusLineData>) => void) => () => void;

  // Snapshots
  ptyGetSnapshot: (id: string) => Promise<IpcResponse<TerminalSnapshot | null>>;
  ptySaveSnapshot: (id: string, payload: TerminalSnapshot) => void;
  ptyClearSnapshot: (id: string) => Promise<IpcResponse<void>>;

  // Task context for SessionStart hook
  ptyWriteTaskContext: (args: { taskId: string; prompt: string }) => Promise<IpcResponse<void>>;

  // App lifecycle
  onBeforeQuit: (callback: () => void) => () => void;
  onFocusTask: (callback: (taskId: string) => void) => () => void;
  onToast: (callback: (data: { message: string; url?: string }) => void) => () => void;

  // Settings
  setDesktopNotification: (opts: { enabled: boolean }) => void;
  setCommitAttribution: (value: string | undefined) => void;
  setClaudeEnvVars: (vars: Record<string, string>) => void;
  setSyncShellEnv: (enabled: boolean) => void;
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

  // Diff editor (read/write through main process; commit browsing)
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

  // RTK (Rust Token Killer)
  rtkGetStatus: () => Promise<IpcResponse<RtkStatus>>;
  rtkSetEnabled: (enabled: boolean) => Promise<IpcResponse<{ warning?: string }>>;
  rtkDownload: () => Promise<IpcResponse<{ warning?: string } | undefined>>;
  rtkTest: () => Promise<IpcResponse<RtkTestResult>>;
  onRtkDownloadProgress: (callback: (progress: RtkDownloadProgress) => void) => () => void;

  // Skills
  skillsRefresh: (args?: { force?: boolean }) => Promise<IpcResponse<SkillsRegistryMeta>>;
  skillsGetMeta: () => Promise<IpcResponse<SkillsRegistryMeta>>;
  skillsGetCategories: () => Promise<IpcResponse<string[]>>;
  skillsSearch: (args: SkillsSearchArgs) => Promise<IpcResponse<SkillsSearchResult>>;
  skillsGetContent: (args: SkillRef) => Promise<IpcResponse<string>>;
  skillsReadLocalSkillMd: (args: {
    skillName: string;
    target: SkillInstallTarget;
  }) => Promise<IpcResponse<string>>;
  skillsInstall: (args: SkillInstallArgs) => Promise<IpcResponse<void>>;
  skillsCheckInstalled: (args: {
    skillName: string;
    probePaths: string[];
    /** Provide for registry skills so the marker file is checked; omit for legacy
     *  presence-only checks. */
    ref?: SkillRef | null;
  }) => Promise<IpcResponse<SkillInstallStatus>>;
  skillsListInstalled: (args: {
    probePaths: string[];
  }) => Promise<IpcResponse<InstalledSkillsResult>>;
  skillsUninstall: (args: SkillUninstallArgs) => Promise<IpcResponse<void>>;
  skillsResetCache: () => Promise<IpcResponse<SkillsRegistryMeta>>;

  // Session (structured view)
  sessionWatch: (args: { taskId: string; taskPath: string }) => Promise<IpcResponse<void>>;
  sessionUnwatch: (taskId: string) => Promise<IpcResponse<void>>;
  sessionGetMessages: (
    taskId: string,
  ) => Promise<IpcResponse<{ messages: ParsedSessionMessage[]; metrics: SessionMetrics } | null>>;
  onSessionUpdate: (callback: (data: SessionUpdate) => void) => () => void;

  // Telemetry
  telemetryCapture: (event: string, properties?: Record<string, unknown>) => Promise<void>;
  telemetryGetStatus: () => Promise<IpcResponse<{ enabled: boolean; envDisabled: boolean }>>;
  telemetrySetEnabled: (enabled: boolean) => Promise<IpcResponse<void>>;

  // Auto-update
  autoUpdateCheck: () => Promise<IpcResponse<void>>;
  autoUpdateDownload: () => Promise<IpcResponse<void>>;
  autoUpdateQuitAndInstall: () => Promise<IpcResponse<void>>;
  autoUpdateGetEnabled: () => Promise<IpcResponse<boolean>>;
  autoUpdateSetEnabled: (enabled: boolean) => Promise<IpcResponse<void>>;
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
