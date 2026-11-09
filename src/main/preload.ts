import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * A main→renderer event subscription: `listen<T>(channel)(callback)` calls
 * `callback(payload)` on each event and returns the unsubscribe.
 */
function listen<T = void>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => process.platform,

  // Dialogs
  showOpenDialog: () => ipcRenderer.invoke('app:showOpenDialog'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  clipboardWriteText: (text: string) => ipcRenderer.send('app:clipboardWriteText', text),
  clipboardReadText: () => ipcRenderer.invoke('app:clipboardReadText'),
  clipboardHasImage: () => ipcRenderer.invoke('app:clipboardHasImage'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openInEditor: (args: { cwd: string; filePath: string; line?: number; col?: number }) =>
    ipcRenderer.invoke('app:openInEditor', args),
  openInIDE: (args: {
    folderPath: string;
    ide?: string;
    customCommand?: { path: string; args: string[] };
  }) => ipcRenderer.invoke('app:openInIDE', args),
  detectAvailableIDEs: () => ipcRenderer.invoke('app:detectAvailableIDEs'),
  pickExecutable: () => ipcRenderer.invoke('app:pickExecutable'),

  // Database - Projects
  getProjects: () => ipcRenderer.invoke('db:getProjects'),
  saveProject: (project: unknown) => ipcRenderer.invoke('db:saveProject', project),
  deleteProject: (id: string, options: unknown) =>
    ipcRenderer.invoke('db:deleteProject', id, options),
  archiveProject: (id: string) => ipcRenderer.invoke('db:archiveProject', id),
  restoreProject: (id: string) => ipcRenderer.invoke('db:restoreProject', id),

  // Database - Tasks
  getTasks: (projectId: string) => ipcRenderer.invoke('db:getTasks', projectId),
  saveTask: (task: unknown) => ipcRenderer.invoke('db:saveTask', task),
  setTaskScripts: (args: {
    id: string;
    setupScript: string | null;
    teardownScript: string | null;
  }) => ipcRenderer.invoke('db:setTaskScripts', args),
  // Task lifecycle (TaskService in main)
  createTask: (input: unknown) => ipcRenderer.invoke('task:create', input),
  deleteTask: (id: string, options?: unknown) => ipcRenderer.invoke('task:delete', id, options),
  archiveTask: (id: string) => ipcRenderer.invoke('task:archive', id),
  restoreTask: (id: string) => ipcRenderer.invoke('task:restore', id),
  setTaskDashAccess: (input: unknown) => ipcRenderer.invoke('task:setDashAccess', input),
  getTaskMessageAddresses: (id: string) => ipcRenderer.invoke('task:messageAddresses', id),
  onTasksChanged: listen<{ projectId: string }>('tasks:changed'),
  onProjectsChanged: listen('projects:changed'),
  reorderTasks: (projectId: string, orderedTaskIds: string[]) =>
    ipcRenderer.invoke('db:reorderTasks', { projectId, orderedTaskIds }),

  // Database - Conversations
  getConversations: (taskId: string) => ipcRenderer.invoke('db:getConversations', taskId),
  getOrCreateDefaultConversation: (taskId: string) =>
    ipcRenderer.invoke('db:getOrCreateDefaultConversation', taskId),

  // Token stats
  getProjectTokenStats: (projectId: string) =>
    ipcRenderer.invoke('tokenStats:getProject', projectId),
  getGlobalTokenStats: () => ipcRenderer.invoke('tokenStats:getGlobal'),
  onTokenStatsUpdated: listen<unknown>('tokenStats:updated'),

  // Claude auto-memory
  memoryGet: (args: { projectPath: string }) => ipcRenderer.invoke('memory:get', args),
  memoryOpenDir: (args: { projectPath: string }) => ipcRenderer.invoke('memory:openDir', args),

  // Worktree
  worktreeMigrationPlan: () => ipcRenderer.invoke('worktree:migrationPlan'),
  worktreeMigrate: (args: unknown) => ipcRenderer.invoke('worktree:migrate', args),
  worktreeSetupList: () => ipcRenderer.invoke('worktree:setupList'),
  worktreeSetupLog: (worktreePath: string) => ipcRenderer.invoke('worktree:setupLog', worktreePath),
  worktreeSetupRerun: (taskId: string) => ipcRenderer.invoke('worktree:setupRerun', taskId),
  onWorktreeSetupChanged: listen<unknown>('worktree:setupChanged'),
  onWorktreeSetupForgotten: listen<{ worktreePath: string }>('worktree:setupForgotten'),
  onWorktreeSetupOutput: listen<{ worktreePath: string; chunk: string }>('worktree:setupOutput'),

  // PTY
  ptyStartDirect: (args: unknown) => ipcRenderer.invoke('pty:startDirect', args),
  ptyTrustWorkspace: (args: unknown) => ipcRenderer.invoke('pty:trustWorkspace', args),
  ptyStart: (args: unknown) => ipcRenderer.invoke('pty:start', args),
  ptyInput: (args: { id: string; data: string }) => ipcRenderer.send('pty:input', args),
  ptyResize: (args: { id: string; cols: number; rows: number }) =>
    ipcRenderer.send('pty:resize', args),
  ptyKill: (id: string) => ipcRenderer.send('pty:kill', id),
  ptyKillAwait: (id: string) => ipcRenderer.invoke('pty:kill-await', id),
  ptyStopSession: (taskId: string) => ipcRenderer.invoke('pty:stopSession', taskId),
  ptyRestartSession: (taskId: string) => ipcRenderer.invoke('pty:restartSession', taskId),
  ptyListForTask: (
    taskId: string,
    opts?: { kinds?: ('agent' | 'shell' | 'tui')[]; featureId?: string },
  ) => ipcRenderer.invoke('pty:listForTask', taskId, opts),

  // Drawer tabs (per-task tab state owned by main)
  drawerTabsList: (taskId: string) => ipcRenderer.invoke('drawerTabs:list', taskId),
  drawerTabsGetActive: (taskId: string) => ipcRenderer.invoke('drawerTabs:getActive', taskId),
  drawerTabsAdd: (taskId: string, opts: unknown) =>
    ipcRenderer.invoke('drawerTabs:add', taskId, opts),
  drawerTabsClose: (tabId: string) => ipcRenderer.invoke('drawerTabs:close', tabId),
  drawerTabsSetActive: (taskId: string, tabId: string) =>
    ipcRenderer.invoke('drawerTabs:setActive', taskId, tabId),
  drawerTabsBulkUpsert: (entries: unknown) => ipcRenderer.invoke('drawerTabs:bulkUpsert', entries),
  drawerTabsSubscribe: (taskId: string) => ipcRenderer.invoke('drawerTabs:subscribe', taskId),
  drawerTabsUnsubscribe: (taskId: string) => ipcRenderer.invoke('drawerTabs:unsubscribe', taskId),
  onDrawerTabsChanged: listen<string>('drawerTabs:changed'),

  // Ports TUI lifecycle
  ptyStartCommand: (opts: unknown) => ipcRenderer.invoke('pty:startCommand', opts),
  requestWizard: (payload: unknown) => ipcRenderer.invoke('wizard:requestStart', payload),
  wizardActive: (q: { featureId: string; taskId: string }) =>
    ipcRenderer.invoke('wizard:active', q),
  wizardCompleted: (q: { featureId: string; cwd: string }) =>
    ipcRenderer.invoke('wizard:completed', q),
  onPortsRestartTask: listen<string>('ports:restart-task'),
  onPortsTuiMigrated: listen<{ fromTaskId: string; toTaskId: string; projectId: string }>(
    'ports:tui:migrated',
  ),
  wizardMessage: (p: { featureId: string; taskId: string; msg: unknown }) =>
    ipcRenderer.send('wizard:message', p),
  onWizardShow: listen<{ featureId: string; taskId: string; msg: unknown }>('wizard:show'),
  onWizardDismiss: listen<{ featureId: string; taskId: string }>('wizard:dismiss'),
  onPtyData: (id: string, callback: (data: string) => void) =>
    listen<string>(`pty:data:${id}`)(callback),
  onPtyExit: (
    id: string,
    callback: (info: { exitCode: number; signal?: number; reattach?: boolean }) => void,
  ) =>
    listen<{ exitCode: number; signal?: number; reattach?: boolean }>(`pty:exit:${id}`)(callback),

  // Activity monitor
  ptyGetAllActivity: () => ipcRenderer.invoke('pty:activity:getAll'),
  onPtyActivity: listen<Record<string, import('@shared/types').ActivityInfo>>('pty:activity'),

  // Remote control
  ptyRemoteControlEnable: (ptyId: string) => ipcRenderer.invoke('pty:remoteControl:enable', ptyId),
  ptyRemoteControlGetAllStates: () => ipcRenderer.invoke('pty:remoteControl:getAllStates'),
  onRemoteControlStateChanged: listen<{
    ptyId: string;
    state: { url: string; active: boolean } | null;
  }>('rc:stateChanged'),

  // Status line data (context + cost + rate limits)
  ptyGetAllStatusLine: () => ipcRenderer.invoke('pty:statusLine:getAll'),
  onPtyStatusLine: listen<Record<string, import('@shared/types').StatusLineData>>('pty:statusLine'),

  // Snapshots
  ptyGetSnapshot: (id: string) => ipcRenderer.invoke('pty:snapshot:get', id),
  ptySaveSnapshot: (id: string, payload: unknown) =>
    ipcRenderer.send('pty:snapshot:save', id, payload),
  ptyClearSnapshot: (id: string) => ipcRenderer.invoke('pty:snapshot:clear', id),

  // Task context for SessionStart hook
  ptyWriteTaskContext: (args: { taskId: string; prompt: string }) =>
    ipcRenderer.invoke('pty:writeTaskContext', args),
  ptySetInitialPrompt: (args: { taskId: string; prompt: string }) =>
    ipcRenderer.invoke('pty:setInitialPrompt', args),

  // App lifecycle
  onBeforeQuit: listen('app:beforeQuit'),
  onFocusTask: listen<{ taskId: string; projectId?: string }>('app:focusTask'),
  onOrchestratorAccessRequest: (callback: (request: { id: string; open: boolean }) => void) => {
    const opened = (_event: unknown, r: { id: string }) => callback({ id: r.id, open: true });
    const ended = (_event: unknown, r: { id: string }) => callback({ id: r.id, open: false });
    ipcRenderer.on('app:orchestratorAccessRequest', opened);
    ipcRenderer.on('app:orchestratorAccessRequestEnded', ended);
    return () => {
      ipcRenderer.removeListener('app:orchestratorAccessRequest', opened);
      ipcRenderer.removeListener('app:orchestratorAccessRequestEnded', ended);
    };
  },
  answerOrchestratorAccess: (answer: { id: string; allowed: boolean }) =>
    ipcRenderer.send('app:orchestratorAccessAnswer', answer),
  onToast: listen<{ message: string; url?: string }>('app:toast'),

  // Settings
  setDesktopNotification: (opts: { enabled: boolean }) =>
    ipcRenderer.send('app:setDesktopNotification', opts),
  setCommitAttribution: (value: string | undefined) =>
    ipcRenderer.send('app:setCommitAttribution', value),
  setClaudeEnvVars: (vars: Record<string, string>) =>
    ipcRenderer.send('app:setClaudeEnvVars', vars),
  setSyncShellEnv: (enabled: boolean) => ipcRenderer.send('app:setSyncShellEnv', enabled),
  setUltracode: (enabled: boolean) => ipcRenderer.send('app:setUltracode', enabled),
  setStopSessionsOnQuit: (enabled: boolean) =>
    ipcRenderer.send('app:setStopSessionsOnQuit', enabled),
  setIsDark: (isDark: boolean) => ipcRenderer.send('app:setIsDark', isDark),
  setOrchestratorAccess: (enabled: boolean) =>
    ipcRenderer.send('app:setOrchestratorAccess', enabled),
  getControlInfo: () => ipcRenderer.invoke('app:getControlInfo'),
  getClaudeAttribution: (projectPath?: string) =>
    ipcRenderer.invoke('app:getClaudeAttribution', projectPath),

  // GitHub
  githubCheckAvailable: () => ipcRenderer.invoke('github:check-available'),
  githubSearchIssues: (cwd: string, query: string) =>
    ipcRenderer.invoke('github:search-issues', { cwd, query }),
  githubGetIssue: (cwd: string, number: number) =>
    ipcRenderer.invoke('github:get-issue', { cwd, number }),
  githubPostBranchComment: (cwd: string, issueNumber: number, branch: string) =>
    ipcRenderer.invoke('github:post-branch-comment', { cwd, issueNumber, branch }),
  githubGetPrsForCheckout: (cwd: string, defaultBranch: string) =>
    ipcRenderer.invoke('github:get-prs-for-checkout', { cwd, defaultBranch }),
  githubWriteCiReport: (args: { cwd: string; number: number; url: string; headSha?: string }) =>
    ipcRenderer.invoke('github:write-ci-report', args),
  githubListPrs: (cwd: string) => ipcRenderer.invoke('github:list-prs', { cwd }),
  githubPreparePrBranch: (cwd: string, prNumber: number, headRefName: string) =>
    ipcRenderer.invoke('github:prepare-pr-branch', { cwd, prNumber, headRefName }),

  // PR review (GitHub or Azure DevOps, picked by main from the project's remote)
  prReviewList: (args: { projectId: string; cwd: string }) =>
    ipcRenderer.invoke('prReview:list', args),
  prReviewLoad: (args: { projectId: string; cwd: string; number: number }) =>
    ipcRenderer.invoke('prReview:load', args),
  prReviewSetResolved: (args: {
    projectId: string;
    cwd: string;
    number: number;
    threadId: string;
    resolved: boolean;
  }) => ipcRenderer.invoke('prReview:setResolved', args),
  prReviewSubmit: (args: {
    projectId: string;
    cwd: string;
    taskId: string;
    number: number;
    verdict: string;
    body: string;
  }) => ipcRenderer.invoke('prReview:submit', args),
  prReviewInReview: (args: { taskId: string; provider: string; number: number }) =>
    ipcRenderer.invoke('prReview:inReview', args),
  prReviewSetInReview: (args: { taskId: string; provider: string; number: number; on: boolean }) =>
    ipcRenderer.invoke('prReview:setInReview', args),
  prReviewGetSummary: (args: { taskId: string; provider: string; number: number }) =>
    ipcRenderer.invoke('prReview:getSummary', args),
  prReviewSetSummary: (args: { taskId: string; provider: string; number: number; body: string }) =>
    ipcRenderer.invoke('prReview:setSummary', args),
  onDiffCommentsChanged: listen<{ taskId: string }>('diffComments:changed'),

  // Azure DevOps
  adoCheckConfigured: (projectId?: string) =>
    ipcRenderer.invoke('ado:check-configured', { projectId }),
  adoTestConnection: (config: unknown) => ipcRenderer.invoke('ado:test-connection', config),
  adoSaveConfig: (config: unknown, projectId?: string) =>
    ipcRenderer.invoke('ado:save-config', { config, projectId }),
  adoGetConfig: (projectId?: string) => ipcRenderer.invoke('ado:get-config', { projectId }),
  adoRemoveConfig: (projectId?: string) => ipcRenderer.invoke('ado:remove-config', { projectId }),
  adoSearchWorkItems: (query: string, projectId?: string) =>
    ipcRenderer.invoke('ado:search-work-items', { query, projectId }),
  adoGetWorkItem: (id: number, projectId?: string) =>
    ipcRenderer.invoke('ado:get-work-item', { id, projectId }),
  adoPostBranchComment: (workItemId: number, branch: string, projectId?: string) =>
    ipcRenderer.invoke('ado:post-branch-comment', { workItemId, branch, projectId }),
  adoGetPrsForCheckout: (args: {
    cwd: string;
    defaultBranch: string;
    gitRemote: string;
    projectId?: string;
  }) => ipcRenderer.invoke('ado:get-prs-for-checkout', args),
  adoListPrs: (gitRemote: string, projectId?: string) =>
    ipcRenderer.invoke('ado:list-prs', { gitRemote, projectId }),
  adoPreparePrBranch: (cwd: string, branch: string) =>
    ipcRenderer.invoke('ado:prepare-pr-branch', { cwd, branch }),

  // Git detection
  detectGit: (folderPath: string) => ipcRenderer.invoke('app:detectGit', folderPath),
  gitInit: (folderPath: string) => ipcRenderer.invoke('git:init', folderPath),
  detectClaude: (args?: { refresh?: boolean }) => ipcRenderer.invoke('app:detectClaude', args),

  // Workspace config (.dash/config.json)
  readWorkspaceConfig: (projectPath: string, opts?: { shared?: boolean }) =>
    ipcRenderer.invoke('workspaceConfig:read', projectPath, opts),
  writeWorkspaceConfig: (args: { projectPath: string; config: unknown }) =>
    ipcRenderer.invoke('workspaceConfig:write', args),

  // Project sources (clone / empty / scaffold)
  projectClone: (args: { url: string; parentDir: string }) =>
    ipcRenderer.invoke('project:clone', args),
  projectCreateEmpty: (args: { parentDir: string; name: string; initGit: boolean }) =>
    ipcRenderer.invoke('project:createEmpty', args),
  projectListDir: (dir: string) => ipcRenderer.invoke('project:listDir', dir),
  scaffoldStart: (args: {
    sessionId: string;
    methodId: string;
    url: string;
    parentDir: string;
    cols: number;
    rows: number;
  }) => ipcRenderer.send('scaffold:start', args),
  scaffoldInput: (args: { sessionId: string; data: string }) =>
    ipcRenderer.send('scaffold:input', args),
  scaffoldResize: (args: { sessionId: string; cols: number; rows: number }) =>
    ipcRenderer.send('scaffold:resize', args),
  scaffoldKill: (args: { sessionId: string }) => ipcRenderer.send('scaffold:kill', args),
  onScaffoldData: listen<{ sessionId: string; data: string }>('scaffold:data'),
  onScaffoldExit: listen<{ sessionId: string; exitCode: number; resultPath: string | null }>(
    'scaffold:exit',
  ),

  // Git operations
  gitClone: (args: { url: string }) => ipcRenderer.invoke('git:clone', args),
  gitGetStatus: (cwd: string) => ipcRenderer.invoke('git:getStatus', cwd),
  gitGetDiff: (args: { cwd: string; filePath?: string; staged?: boolean; contextLines?: number }) =>
    ipcRenderer.invoke('git:getDiff', args),
  gitGetDiffUntracked: (args: { cwd: string; filePath: string; contextLines?: number }) =>
    ipcRenderer.invoke('git:getDiffUntracked', args),
  gitStageFiles: (args: { cwd: string; filePaths: string[] }) =>
    ipcRenderer.invoke('git:stageFiles', args),
  gitStageAll: (cwd: string) => ipcRenderer.invoke('git:stageAll', cwd),
  gitUnstageFiles: (args: { cwd: string; filePaths: string[] }) =>
    ipcRenderer.invoke('git:unstageFiles', args),
  gitUnstageAll: (cwd: string) => ipcRenderer.invoke('git:unstageAll', cwd),
  gitDiscardFiles: (args: { cwd: string; filePaths: string[] }) =>
    ipcRenderer.invoke('git:discardFiles', args),
  gitignoreAdd: (args: { cwd: string; filePath: string }) =>
    ipcRenderer.invoke('git:gitignoreAdd', args),
  gitCommit: (args: { cwd: string; message: string; allowEmpty?: boolean }) =>
    ipcRenderer.invoke('git:commit', args),
  gitCommitStart: (args: { cwd: string; message: string; allowEmpty?: boolean }) =>
    ipcRenderer.invoke('git:commitStart', args),
  gitCommitCancel: (requestId: string) => ipcRenderer.invoke('git:commitCancel', { requestId }),
  onCommitEvent: listen<{ requestId: string; event: unknown }>('git:commitEvent'),
  gitPush: (cwd: string) => ipcRenderer.invoke('git:push', cwd),
  gitRemoteBranchExists: (args: { cwd: string; branch: string }) =>
    ipcRenderer.invoke('git:remoteBranchExists', args),
  gitCurrentBranch: (cwd: string) => ipcRenderer.invoke('git:currentBranch', cwd),

  gitCheckoutBranch: (args: { cwd: string; branch: string }) =>
    ipcRenderer.invoke('git:checkoutBranch', args),

  gitUpdateBranchToRemote: (args: { cwd: string; branch: string }) =>
    ipcRenderer.invoke('git:updateBranchToRemote', args),

  // Branch listing
  gitListBranches: (cwd: string) => ipcRenderer.invoke('git:listBranches', cwd),

  // Commit graph
  gitGetCommitGraph: (args: { cwd: string; limit?: number; skip?: number }) =>
    ipcRenderer.invoke('git:getCommitGraph', args),
  gitGetCommitDetail: (args: { cwd: string; hash: string }) =>
    ipcRenderer.invoke('git:getCommitDetail', args),

  // File watcher
  gitWatch: (args: { id: string; cwd: string }) => ipcRenderer.invoke('git:watch', args),
  gitUnwatch: (id: string) => ipcRenderer.invoke('git:unwatch', id),
  onGitFileChanged: listen<string>('git:fileChanged'),

  // Diff editor
  editorReadWorking: (args: { cwd: string; filePath: string; ref: 'HEAD' | 'index' }) =>
    ipcRenderer.invoke('editor:readWorking', args),
  editorReadCommit: (args: { cwd: string; filePath: string; hash: string; base?: string }) =>
    ipcRenderer.invoke('editor:readCommit', args),
  editorWriteWorking: (args: {
    cwd: string;
    filePath: string;
    content: string;
    expectedMtimeMs: number;
    expectedSizeBytes: number;
  }) => ipcRenderer.invoke('editor:writeWorking', args),
  editorListCommits: (args: { cwd: string; limit?: number }) =>
    ipcRenderer.invoke('editor:listCommits', args),
  editorListFilesInCommit: (args: { cwd: string; hash: string; base?: string }) =>
    ipcRenderer.invoke('editor:listFilesInCommit', args),
  editorListRepoFiles: (args: {
    cwd: string;
    source: { kind: 'working' } | { kind: 'commit'; hash: string };
  }) => ipcRenderer.invoke('editor:listRepoFiles', args),
  editorListIgnoredFiles: (args: { cwd: string }) =>
    ipcRenderer.invoke('editor:listIgnoredFiles', args),
  editorResolveDefaultBase: (args: { cwd: string }) =>
    ipcRenderer.invoke('editor:resolveDefaultBase', args),
  editorListFilesAgainstBase: (args: { cwd: string; base: string }) =>
    ipcRenderer.invoke('editor:listFilesAgainstBase', args),
  editorReadAgainstBase: (args: { cwd: string; filePath: string; base: string }) =>
    ipcRenderer.invoke('editor:readAgainstBase', args),
  editorBlame: (args: { cwd: string; filePath: string; ref: string | null }) =>
    ipcRenderer.invoke('editor:blame', args),

  // Diff editor comments
  diffCommentsList: (args: { taskId: string }) => ipcRenderer.invoke('diffComments:list', args),
  diffCommentsUpsert: (c: import('@shared/types').DiffCommentInput) =>
    ipcRenderer.invoke('diffComments:upsert', c),
  diffCommentsDelete: (args: { id: string }) => ipcRenderer.invoke('diffComments:delete', args),
  diffCommentsPruneForTask: (args: { taskId: string; existingFilePaths: string[] }) =>
    ipcRenderer.invoke('diffComments:pruneForTask', args),

  // RTK (Rust Token Killer)
  rtkGetStatus: () => ipcRenderer.invoke('rtk:getStatus'),
  rtkSetEnabled: (enabled: boolean) => ipcRenderer.invoke('rtk:setEnabled', enabled),
  rtkDownload: () => ipcRenderer.invoke('rtk:download'),
  rtkTest: () => ipcRenderer.invoke('rtk:test'),
  onRtkDownloadProgress:
    listen<import('@shared/types').RtkDownloadProgress>('rtk:downloadProgress'),

  // Skills
  skillsRefresh: (args?: { force?: boolean }) => ipcRenderer.invoke('skills:refresh', args),
  skillsGetMeta: () => ipcRenderer.invoke('skills:getMeta'),
  skillsGetCategories: () => ipcRenderer.invoke('skills:getCategories'),
  skillsSearch: (args: import('@shared/types').SkillsSearchArgs) =>
    ipcRenderer.invoke('skills:search', args),
  skillsGetContent: (args: import('@shared/types').SkillRef) =>
    ipcRenderer.invoke('skills:getContent', args),
  skillsReadLocalSkillMd: (args: {
    skillName: string;
    target: import('@shared/types').SkillInstallTarget;
  }) => ipcRenderer.invoke('skills:readLocalSkillMd', args),
  skillsInstall: (args: import('@shared/types').SkillInstallArgs) =>
    ipcRenderer.invoke('skills:install', args),
  skillsCheckInstalled: (args: {
    skillName: string;
    probePaths: string[];
    ref?: import('@shared/types').SkillRef | null;
  }) => ipcRenderer.invoke('skills:checkInstalled', args),
  skillsListInstalled: (args: { probePaths: string[] }) =>
    ipcRenderer.invoke('skills:listInstalled', args),
  skillsUninstall: (args: import('@shared/types').SkillUninstallArgs) =>
    ipcRenderer.invoke('skills:uninstall', args),
  skillsResetCache: () => ipcRenderer.invoke('skills:resetCache'),

  // Plugins (Claude Code native plugin manager)
  pluginsGetOverview: () => ipcRenderer.invoke('plugins:getOverview'),
  pluginsAddMarketplace: (args: import('@shared/types').AddMarketplaceArgs) =>
    ipcRenderer.invoke('plugins:addMarketplace', args),
  pluginsRemoveMarketplace: (args: import('@shared/types').RemoveMarketplaceArgs) =>
    ipcRenderer.invoke('plugins:removeMarketplace', args),
  pluginsUpdateMarketplace: (args?: { name?: string }) =>
    ipcRenderer.invoke('plugins:updateMarketplace', args),
  pluginsInstall: (args: import('@shared/types').PluginInstallArgs) =>
    ipcRenderer.invoke('plugins:install', args),
  pluginsUninstall: (args: import('@shared/types').PluginUninstallArgs) =>
    ipcRenderer.invoke('plugins:uninstall', args),
  pluginsSetEnabled: (args: import('@shared/types').PluginSetEnabledArgs) =>
    ipcRenderer.invoke('plugins:setEnabled', args),

  // Extensions (unified skills + plugins overview)
  extensionsGetOverview: (args: import('@shared/types').ExtensionScopeInput) =>
    ipcRenderer.invoke('extensions:getOverview', args),
  extensionsSetSkillOverride: (args: import('@shared/types').SetSkillOverrideArgs) =>
    ipcRenderer.invoke('extensions:setSkillOverride', args),
  extensionsGetPluginComponents: (args: import('@shared/types').GetPluginComponentsArgs) =>
    ipcRenderer.invoke('extensions:getPluginComponents', args),
  extensionsGetPluginComponentDetail: (
    args: import('@shared/types').GetPluginComponentDetailArgs,
  ) => ipcRenderer.invoke('extensions:getPluginComponentDetail', args),
  extensionsGetSkillDetail: (args: import('@shared/types').GetSkillDetailArgs) =>
    ipcRenderer.invoke('extensions:getSkillDetail', args),
  extensionsGetRegistrySkillDetail: (args: import('@shared/types').SkillRef) =>
    ipcRenderer.invoke('extensions:getRegistrySkillDetail', args),

  // Sessions under Claude Code's supervisor
  sessionList: (args?: { refresh?: boolean }) => ipcRenderer.invoke('session:list', args),
  onSessionList: listen<unknown>('session:list'),
  sessionAttach: (args: unknown) => ipcRenderer.invoke('session:attach', args),
  sessionStop: (jobId: string) => ipcRenderer.invoke('session:stop', jobId),
  sessionRemove: (jobId: string) => ipcRenderer.invoke('session:remove', jobId),
  sessionAdopt: (args: { projectId: string; jobId: string }) =>
    ipcRenderer.invoke('session:adopt', args),

  // Telemetry
  telemetryCapture: (event: string, properties?: Record<string, unknown>) =>
    ipcRenderer.invoke('telemetry:capture', { event, properties }),
  telemetryGetStatus: () => ipcRenderer.invoke('telemetry:getStatus'),
  telemetrySetEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:setEnabled', enabled),

  // Auto-update
  autoUpdateCheck: () => ipcRenderer.invoke('autoUpdate:check'),
  autoUpdateDownload: () => ipcRenderer.invoke('autoUpdate:download'),
  autoUpdateQuitAndInstall: () => ipcRenderer.invoke('autoUpdate:quitAndInstall'),
  autoUpdateGetEnabled: () => ipcRenderer.invoke('autoUpdate:getEnabled'),
  autoUpdateSetEnabled: (enabled: boolean) => ipcRenderer.invoke('autoUpdate:setEnabled', enabled),
  autoUpdateGetStatus: () => ipcRenderer.invoke('autoUpdate:getStatus'),
  onAutoUpdateStatus: listen<import('@shared/types').AutoUpdateStatus>('autoUpdate:status'),

  // Workspace ports
  portsList: (taskId: string) => ipcRenderer.invoke('ports:list', taskId),
  portsRefresh: (taskId: string) => ipcRenderer.invoke('ports:refresh', taskId),
  portsLivenessGet: (taskId: string) => ipcRenderer.invoke('ports:liveness:get', taskId),
  portsUnwatch: (taskId: string) => ipcRenderer.invoke('ports:unwatch', taskId),
  portsOpenUrl: (port: number) => ipcRenderer.invoke('ports:openUrl', port),
  portsDetect: (taskId: string) => ipcRenderer.invoke('ports:detect', taskId),
  portsWatchConfig: (taskId: string) => ipcRenderer.invoke('ports:watchConfig', taskId),
  portsServiceStart: (taskId: string, port: unknown) =>
    ipcRenderer.invoke('ports:service:start', taskId, port),
  portsServiceStop: (taskId: string, port: unknown) =>
    ipcRenderer.invoke('ports:service:stop', taskId, port),
  portsServiceLogs: (taskId: string, port: unknown) =>
    ipcRenderer.invoke('ports:service:logs', taskId, port),
  portsServiceStartAll: (taskId: string) => ipcRenderer.invoke('ports:service:startAll', taskId),
  portsServiceStopAll: (taskId: string) => ipcRenderer.invoke('ports:service:stopAll', taskId),
  portsServiceStatus: (taskId: string) => ipcRenderer.invoke('ports:service:status', taskId),
  portsServiceReleaseTab: (taskId: string, tabId: string) =>
    ipcRenderer.invoke('ports:service:releaseTab', taskId, tabId),
  onPortsServiceChanged: listen<{ taskId: string }>('ports:service:changed'),
  onPortsServiceFocusTab: listen<{ taskId: string; tabId: string; reset: boolean }>(
    'ports:service:focusTab',
  ),
  onPortsConfigChanged: listen<{ taskId: string }>('ports:configChanged'),
  onPortsLiveness: listen<import('@shared/types').PortLivenessUpdate>('ports:liveness'),
});
