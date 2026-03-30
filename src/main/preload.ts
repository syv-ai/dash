import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => process.platform,

  // Dialogs
  showOpenDialog: () => ipcRenderer.invoke('app:showOpenDialog'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  openInEditor: (args: { cwd: string; filePath: string; line?: number; col?: number }) =>
    ipcRenderer.invoke('app:openInEditor', args),
  openInIDE: (args: { folderPath: string; ide?: 'cursor' | 'code' }) =>
    ipcRenderer.invoke('app:openInIDE', args),
  detectAvailableIDEs: () => ipcRenderer.invoke('app:detectAvailableIDEs'),

  // Database - Projects
  getProjects: () => ipcRenderer.invoke('db:getProjects'),
  saveProject: (project: unknown) => ipcRenderer.invoke('db:saveProject', project),
  deleteProject: (id: string) => ipcRenderer.invoke('db:deleteProject', id),

  // Database - Tasks
  getTasks: (projectId: string) => ipcRenderer.invoke('db:getTasks', projectId),
  saveTask: (task: unknown) => ipcRenderer.invoke('db:saveTask', task),
  deleteTask: (id: string) => ipcRenderer.invoke('db:deleteTask', id),
  archiveTask: (id: string) => ipcRenderer.invoke('db:archiveTask', id),
  restoreTask: (id: string) => ipcRenderer.invoke('db:restoreTask', id),

  // Database - Conversations
  getConversations: (taskId: string) => ipcRenderer.invoke('db:getConversations', taskId),
  getOrCreateDefaultConversation: (taskId: string) =>
    ipcRenderer.invoke('db:getOrCreateDefaultConversation', taskId),

  // Worktree
  worktreeCreate: (args: unknown) => ipcRenderer.invoke('worktree:create', args),
  worktreeRemove: (args: unknown) => ipcRenderer.invoke('worktree:remove', args),
  worktreeClaimReserve: (args: unknown) => ipcRenderer.invoke('worktree:claimReserve', args),
  worktreeEnsureReserve: (args: unknown) => ipcRenderer.invoke('worktree:ensureReserve', args),
  worktreeHasReserve: (projectId: string) => ipcRenderer.invoke('worktree:hasReserve', projectId),

  // PTY
  ptyStartDirect: (args: unknown) => ipcRenderer.invoke('pty:startDirect', args),
  ptyStart: (args: unknown) => ipcRenderer.invoke('pty:start', args),
  ptyInput: (args: { id: string; data: string }) => ipcRenderer.send('pty:input', args),
  ptyResize: (args: { id: string; cols: number; rows: number }) =>
    ipcRenderer.send('pty:resize', args),
  ptyKill: (id: string) => ipcRenderer.send('pty:kill', id),
  onPtyData: (id: string, callback: (data: string) => void) => {
    const handler = (_event: unknown, data: string) => callback(data);
    ipcRenderer.on(`pty:data:${id}`, handler);
    return () => {
      ipcRenderer.removeListener(`pty:data:${id}`, handler);
    };
  },
  onPtyExit: (id: string, callback: (info: { exitCode: number; signal?: number }) => void) => {
    const handler = (_event: unknown, info: { exitCode: number; signal?: number }) =>
      callback(info);
    ipcRenderer.on(`pty:exit:${id}`, handler);
    return () => {
      ipcRenderer.removeListener(`pty:exit:${id}`, handler);
    };
  },

  // Activity monitor
  ptyGetAllActivity: () => ipcRenderer.invoke('pty:activity:getAll'),
  onPtyActivity: (callback: (data: Record<string, 'busy' | 'idle' | 'waiting'>) => void) => {
    const handler = (_event: unknown, data: Record<string, 'busy' | 'idle' | 'waiting'>) =>
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
  onPtyStatusLine: (callback: (data: Record<string, unknown>) => void) => {
    const handler = (_event: unknown, data: Record<string, unknown>) => callback(data);
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

  // Session detection
  ptyHasClaudeSession: (cwd: string) => ipcRenderer.invoke('pty:hasClaudeSession', cwd),

  // Task context for SessionStart hook
  ptyWriteTaskContext: (args: { cwd: string; prompt: string; meta?: unknown }) =>
    ipcRenderer.invoke('pty:writeTaskContext', args),

  // App lifecycle
  onBeforeQuit: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('app:beforeQuit', handler);
    return () => {
      ipcRenderer.removeListener('app:beforeQuit', handler);
    };
  },
  onFocusTask: (callback: (taskId: string) => void) => {
    const handler = (_event: unknown, taskId: string) => callback(taskId);
    ipcRenderer.on('app:focusTask', handler);
    return () => {
      ipcRenderer.removeListener('app:focusTask', handler);
    };
  },
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
  githubLinkBranch: (cwd: string, issueNumber: number, branch: string) =>
    ipcRenderer.invoke('github:link-branch', { cwd, issueNumber, branch }),
  githubGetPrForBranch: (cwd: string, branch: string) =>
    ipcRenderer.invoke('github:get-pr-for-branch', { cwd, branch }),

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
  adoGetPrForBranch: (branch: string, gitRemote: string, projectId?: string) =>
    ipcRenderer.invoke('ado:get-pr-for-branch', { branch, gitRemote, projectId }),

  // Git detection
  detectGit: (folderPath: string) => ipcRenderer.invoke('app:detectGit', folderPath),
  gitInit: (folderPath: string) => ipcRenderer.invoke('git:init', folderPath),
  detectClaude: () => ipcRenderer.invoke('app:detectClaude'),

  // Git operations
  gitClone: (args: { url: string }) => ipcRenderer.invoke('git:clone', args),
  gitGetStatus: (cwd: string) => ipcRenderer.invoke('git:getStatus', cwd),
  gitGetDiff: (args: { cwd: string; filePath?: string; staged?: boolean; contextLines?: number }) =>
    ipcRenderer.invoke('git:getDiff', args),
  gitGetDiffUntracked: (args: { cwd: string; filePath: string; contextLines?: number }) =>
    ipcRenderer.invoke('git:getDiffUntracked', args),
  gitStageFile: (args: { cwd: string; filePath: string }) =>
    ipcRenderer.invoke('git:stageFile', args),
  gitStageAll: (cwd: string) => ipcRenderer.invoke('git:stageAll', cwd),
  gitUnstageFile: (args: { cwd: string; filePath: string }) =>
    ipcRenderer.invoke('git:unstageFile', args),
  gitUnstageAll: (cwd: string) => ipcRenderer.invoke('git:unstageAll', cwd),
  gitDiscardFile: (args: { cwd: string; filePath: string }) =>
    ipcRenderer.invoke('git:discardFile', args),
  gitCommit: (args: { cwd: string; message: string }) => ipcRenderer.invoke('git:commit', args),
  gitPush: (cwd: string) => ipcRenderer.invoke('git:push', cwd),
  gitRemoteBranchExists: (args: { cwd: string; branch: string }) =>
    ipcRenderer.invoke('git:remoteBranchExists', args),

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

  // Pixel Agents
  pixelAgentsGetConfig: () => ipcRenderer.invoke('pixelAgents:getConfig'),
  pixelAgentsSaveConfig: (config: unknown) => ipcRenderer.invoke('pixelAgents:saveConfig', config),
  pixelAgentsGetStatus: () => ipcRenderer.invoke('pixelAgents:getStatus'),
  pixelAgentsStart: () => ipcRenderer.invoke('pixelAgents:start'),
  pixelAgentsStop: () => ipcRenderer.invoke('pixelAgents:stop'),
  onPixelAgentsStatusChanged: (callback: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on('pixelAgents:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('pixelAgents:statusChanged', handler);
    };
  },

  // Telemetry
  telemetryCapture: (event: string, properties?: Record<string, unknown>) =>
    ipcRenderer.invoke('telemetry:capture', { event, properties }),
  telemetryGetStatus: () => ipcRenderer.invoke('telemetry:getStatus'),
  telemetrySetEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:setEnabled', enabled),

  // Auto-update
  autoUpdateCheck: () => ipcRenderer.invoke('autoUpdate:check'),
  autoUpdateDownload: () => ipcRenderer.invoke('autoUpdate:download'),
  autoUpdateQuitAndInstall: () => ipcRenderer.invoke('autoUpdate:quitAndInstall'),
  onAutoUpdateAvailable: (callback: (info: { version: string }) => void) => {
    const handler = (_event: unknown, info: { version: string }) => callback(info);
    ipcRenderer.on('autoUpdate:available', handler);
    return () => {
      ipcRenderer.removeListener('autoUpdate:available', handler);
    };
  },
  onAutoUpdateNotAvailable: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('autoUpdate:notAvailable', handler);
    return () => {
      ipcRenderer.removeListener('autoUpdate:notAvailable', handler);
    };
  },
  onAutoUpdateDownloadProgress: (
    callback: (progress: {
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }) => void,
  ) => {
    const handler = (
      _event: unknown,
      progress: { percent: number; bytesPerSecond: number; transferred: number; total: number },
    ) => callback(progress);
    ipcRenderer.on('autoUpdate:downloadProgress', handler);
    return () => {
      ipcRenderer.removeListener('autoUpdate:downloadProgress', handler);
    };
  },
  onAutoUpdateDownloaded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('autoUpdate:downloaded', handler);
    return () => {
      ipcRenderer.removeListener('autoUpdate:downloaded', handler);
    };
  },
  onAutoUpdateError: (callback: (info: { message: string; detail: string }) => void) => {
    const handler = (_event: unknown, info: { message: string; detail: string }) => callback(info);
    ipcRenderer.on('autoUpdate:error', handler);
    return () => {
      ipcRenderer.removeListener('autoUpdate:error', handler);
    };
  },
});
