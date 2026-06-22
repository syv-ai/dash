import type { IpcResponse } from '../../shared/types';

/** App info, dialogs, external/editor/IDE launch, app-lifecycle events, and
 *  settings mutations — the cross-cutting "shell" surface. */
export interface SystemApi {
  // App
  getAppVersion: () => Promise<string>;
  getPlatform: () => string;

  // Dialogs / external
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

  // App lifecycle
  onBeforeQuit: (callback: () => void) => () => void;
  onFocusTask: (callback: (taskId: string) => void) => () => void;
  onToast: (callback: (data: { message: string; url?: string }) => void) => () => void;

  // Settings
  setDesktopNotification: (opts: { enabled: boolean }) => void;
  setCommitAttribution: (value: string | undefined) => void;
  setClaudeEnvVars: (vars: Record<string, string>) => void;
  setSyncShellEnv: (enabled: boolean) => void;
  setUltracode: (enabled: boolean) => void;
  getClaudeAttribution: (projectPath?: string) => Promise<IpcResponse<string | null>>;
}
