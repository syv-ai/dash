import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => process.platform,

  // Dialogs
  showOpenDialog: () => ipcRenderer.invoke('app:showOpenDialog'),

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
  onPtyActivity: (callback: (data: Record<string, 'busy' | 'idle'>) => void) => {
    const handler = (_event: unknown, data: Record<string, 'busy' | 'idle'>) => callback(data);
    ipcRenderer.on('pty:activity', handler);
    return () => {
      ipcRenderer.removeListener('pty:activity', handler);
    };
  },

  // Snapshots
  ptyGetSnapshot: (id: string) => ipcRenderer.invoke('pty:snapshot:get', id),
  ptySaveSnapshot: (id: string, payload: unknown) =>
    ipcRenderer.send('pty:snapshot:save', id, payload),
  ptyClearSnapshot: (id: string) => ipcRenderer.invoke('pty:snapshot:clear', id),

  // Session detection
  ptyHasClaudeSession: (cwd: string) => ipcRenderer.invoke('pty:hasClaudeSession', cwd),

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

  // Settings
  setDesktopNotification: (opts: { enabled: boolean }) =>
    ipcRenderer.send('app:setDesktopNotification', opts),

  // Git detection
  detectGit: (folderPath: string) => ipcRenderer.invoke('app:detectGit', folderPath),
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

  // Branch listing
  gitListBranches: (cwd: string) => ipcRenderer.invoke('git:listBranches', cwd),

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
});
