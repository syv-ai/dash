import { contextBridge, ipcRenderer, webUtils } from 'electron';

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
  onTasksChanged: (callback: (data: { projectId: string }) => void) => {
    const handler = (_event: unknown, data: { projectId: string }) => callback(data);
    ipcRenderer.on('tasks:changed', handler);
    return () => {
      ipcRenderer.removeListener('tasks:changed', handler);
    };
  },
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
  onTokenStatsUpdated: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('tokenStats:updated', handler);
    return () => {
      ipcRenderer.removeListener('tokenStats:updated', handler);
    };
  },

  // Claude auto-memory
  memoryGet: (args: { projectPath: string }) => ipcRenderer.invoke('memory:get', args),
  memoryOpenDir: (args: { projectPath: string }) => ipcRenderer.invoke('memory:openDir', args),

  // Worktree
  worktreeMigrationPlan: () => ipcRenderer.invoke('worktree:migrationPlan'),
  worktreeMigrate: (args: unknown) => ipcRenderer.invoke('worktree:migrate', args),

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
  onDrawerTabsChanged: (cb: (taskId: string) => void) => {
    const handler = (_event: unknown, taskId: string) => cb(taskId);
    ipcRenderer.on('drawerTabs:changed', handler);
    return () => ipcRenderer.removeListener('drawerTabs:changed', handler);
  },

  // Ports TUI lifecycle
  ptyStartCommand: (opts: unknown) => ipcRenderer.invoke('pty:startCommand', opts),
  requestWizard: (payload: unknown) => ipcRenderer.invoke('wizard:requestStart', payload),
  wizardActive: (q: { featureId: string; taskId: string }) =>
    ipcRenderer.invoke('wizard:active', q),
  wizardCompleted: (q: { featureId: string; cwd: string }) =>
    ipcRenderer.invoke('wizard:completed', q),
  onPortsRestartTask: (cb: (taskId: string) => void) => {
    const handler = (_event: unknown, taskId: string) => cb(taskId);
    ipcRenderer.on('ports:restart-task', handler);
    return () => ipcRenderer.removeListener('ports:restart-task', handler);
  },
  onPortsTuiMigrated: (
    cb: (info: { fromTaskId: string; toTaskId: string; projectId: string }) => void,
  ) => {
    const handler = (
      _event: unknown,
      info: { fromTaskId: string; toTaskId: string; projectId: string },
    ) => cb(info);
    ipcRenderer.on('ports:tui:migrated', handler);
    return () => ipcRenderer.removeListener('ports:tui:migrated', handler);
  },
  wizardMessage: (p: { featureId: string; taskId: string; msg: unknown }) =>
    ipcRenderer.send('wizard:message', p),
  onWizardShow: (cb: (data: { featureId: string; taskId: string; msg: unknown }) => void) => {
    const handler = (_event: unknown, data: { featureId: string; taskId: string; msg: unknown }) =>
      cb(data);
    ipcRenderer.on('wizard:show', handler);
    return () => ipcRenderer.removeListener('wizard:show', handler);
  },
  onWizardDismiss: (cb: (data: { featureId: string; taskId: string }) => void) => {
    const handler = (_event: unknown, data: { featureId: string; taskId: string }) => cb(data);
    ipcRenderer.on('wizard:dismiss', handler);
    return () => ipcRenderer.removeListener('wizard:dismiss', handler);
  },
  onPtyData: (id: string, callback: (data: string) => void) => {
    const handler = (_event: unknown, data: string) => callback(data);
    ipcRenderer.on(`pty:data:${id}`, handler);
    return () => {
      ipcRenderer.removeListener(`pty:data:${id}`, handler);
    };
  },
  onPtyExit: (
    id: string,
    callback: (info: { exitCode: number; signal?: number; reattach?: boolean }) => void,
  ) => {
    const handler = (
      _event: unknown,
      info: { exitCode: number; signal?: number; reattach?: boolean },
    ) => callback(info);
    ipcRenderer.on(`pty:exit:${id}`, handler);
    return () => {
      ipcRenderer.removeListener(`pty:exit:${id}`, handler);
    };
  },

  // Activity monitor
  ptyGetAllActivity: () => ipcRenderer.invoke('pty:activity:getAll'),
  onPtyActivity: (
    callback: (data: Record<string, import('@shared/types').ActivityInfo>) => void,
  ) => {
    const handler = (_event: unknown, data: Record<string, import('@shared/types').ActivityInfo>) =>
      callback(data);
    ipcRenderer.on('pty:activity', handler);
    return () => {
      ipcRenderer.removeListener('pty:activity', handler);
    };
  },

  // Remote control
  ptyRemoteControlEnable: (ptyId: string) => ipcRenderer.invoke('pty:remoteControl:enable', ptyId),
  ptyRemoteControlGetAllStates: () => ipcRenderer.invoke('pty:remoteControl:getAllStates'),
  onRemoteControlStateChanged: (
    callback: (data: { ptyId: string; state: { url: string; active: boolean } | null }) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: { ptyId: string; state: { url: string; active: boolean } | null },
    ) => callback(data);
    ipcRenderer.on('rc:stateChanged', handler);
    return () => {
      ipcRenderer.removeListener('rc:stateChanged', handler);
    };
  },

  // Status line data (context + cost + rate limits)
  ptyGetAllStatusLine: () => ipcRenderer.invoke('pty:statusLine:getAll'),
  onPtyStatusLine: (
    callback: (data: Record<string, import('@shared/types').StatusLineData>) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: Record<string, import('@shared/types').StatusLineData>,
    ) => callback(data);
    ipcRenderer.on('pty:statusLine', handler);
    return () => {
      ipcRenderer.removeListener('pty:statusLine', handler);
    };
  },

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
  onBeforeQuit: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('app:beforeQuit', handler);
    return () => {
      ipcRenderer.removeListener('app:beforeQuit', handler);
    };
  },
  onFocusTask: (callback: (target: { taskId: string; projectId?: string }) => void) => {
    const handler = (_event: unknown, target: { taskId: string; projectId?: string }) =>
      callback(target);
    ipcRenderer.on('app:focusTask', handler);
    return () => {
      ipcRenderer.removeListener('app:focusTask', handler);
    };
  },
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
  onToast: (callback: (data: { message: string; url?: string }) => void) => {
    const handler = (_event: unknown, data: { message: string; url?: string }) => callback(data);
    ipcRenderer.on('app:toast', handler);
    return () => {
      ipcRenderer.removeListener('app:toast', handler);
    };
  },

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
  getClaudeDefaultPermissionMode: (projectPath?: string) =>
    ipcRenderer.invoke('app:getClaudeDefaultPermissionMode', projectPath),

  // GitHub
  githubCheckAvailable: () => ipcRenderer.invoke('github:check-available'),
  githubSearchIssues: (cwd: string, query: string) =>
    ipcRenderer.invoke('github:search-issues', { cwd, query }),
  githubGetIssue: (cwd: string, number: number) =>
    ipcRenderer.invoke('github:get-issue', { cwd, number }),
  githubPostBranchComment: (cwd: string, issueNumber: number, branch: string) =>
    ipcRenderer.invoke('github:post-branch-comment', { cwd, issueNumber, branch }),
  githubLinkBranch: (cwd: string, issueNumber: number, branch: string) =>
    ipcRenderer.invoke('github:link-branch', { cwd, issueNumber, branch }),
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
  onDiffCommentsChanged: (callback: (data: { taskId: string }) => void) => {
    const handler = (_event: unknown, data: { taskId: string }) => callback(data);
    ipcRenderer.on('diffComments:changed', handler);
    return () => {
      ipcRenderer.removeListener('diffComments:changed', handler);
    };
  },

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
  onScaffoldData: (callback: (p: { sessionId: string; data: string }) => void) => {
    const handler = (_e: unknown, p: { sessionId: string; data: string }) => callback(p);
    ipcRenderer.on('scaffold:data', handler);
    return () => ipcRenderer.removeListener('scaffold:data', handler);
  },
  onScaffoldExit: (
    callback: (p: { sessionId: string; exitCode: number; resultPath: string | null }) => void,
  ) => {
    const handler = (
      _e: unknown,
      p: { sessionId: string; exitCode: number; resultPath: string | null },
    ) => callback(p);
    ipcRenderer.on('scaffold:exit', handler);
    return () => ipcRenderer.removeListener('scaffold:exit', handler);
  },

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
  onCommitEvent: (cb: (msg: { requestId: string; event: unknown }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: { requestId: string; event: unknown }) =>
      cb(msg);
    ipcRenderer.on('git:commitEvent', listener);
    return () => ipcRenderer.removeListener('git:commitEvent', listener);
  },
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
  onGitFileChanged: (callback: (id: string) => void) => {
    const handler = (_event: unknown, id: string) => callback(id);
    ipcRenderer.on('git:fileChanged', handler);
    return () => {
      ipcRenderer.removeListener('git:fileChanged', handler);
    };
  },

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
  onRtkDownloadProgress: (
    callback: (progress: import('@shared/types').RtkDownloadProgress) => void,
  ) => {
    const handler = (_event: unknown, progress: import('@shared/types').RtkDownloadProgress) =>
      callback(progress);
    ipcRenderer.on('rtk:downloadProgress', handler);
    return () => {
      ipcRenderer.removeListener('rtk:downloadProgress', handler);
    };
  },

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
  onSessionList: (callback: (rows: unknown) => void) => {
    const handler = (_event: unknown, rows: unknown) => callback(rows);
    ipcRenderer.on('session:list', handler);
    return () => {
      ipcRenderer.removeListener('session:list', handler);
    };
  },
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
  onAutoUpdateStatus: (callback: (status: import('@shared/types').AutoUpdateStatus) => void) => {
    const handler = (_event: unknown, status: import('@shared/types').AutoUpdateStatus) =>
      callback(status);
    ipcRenderer.on('autoUpdate:status', handler);
    return () => {
      ipcRenderer.removeListener('autoUpdate:status', handler);
    };
  },

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
  onPortsServiceChanged: (cb: (data: { taskId: string }) => void) => {
    const handler = (_event: unknown, data: { taskId: string }) => cb(data);
    ipcRenderer.on('ports:service:changed', handler);
    return () => ipcRenderer.removeListener('ports:service:changed', handler);
  },
  onPortsServiceFocusTab: (
    cb: (data: { taskId: string; tabId: string; reset: boolean }) => void,
  ) => {
    const handler = (_event: unknown, data: { taskId: string; tabId: string; reset: boolean }) =>
      cb(data);
    ipcRenderer.on('ports:service:focusTab', handler);
    return () => ipcRenderer.removeListener('ports:service:focusTab', handler);
  },
  onPortsConfigChanged: (callback: (data: { taskId: string }) => void) => {
    const handler = (_event: unknown, data: { taskId: string }) => callback(data);
    ipcRenderer.on('ports:configChanged', handler);
    return () => {
      ipcRenderer.removeListener('ports:configChanged', handler);
    };
  },
  onPortsLiveness: (callback: (update: import('@shared/types').PortLivenessUpdate) => void) => {
    const handler = (_event: unknown, update: import('@shared/types').PortLivenessUpdate) =>
      callback(update);
    ipcRenderer.on('ports:liveness', handler);
    return () => {
      ipcRenderer.removeListener('ports:liveness', handler);
    };
  },
});
