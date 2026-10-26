import type { ControlInfo, IpcResponse, PermissionMode } from '../../shared/types';

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
  clipboardHasImage: () => Promise<boolean>;
  /** A dropped file's path on disk; '' for one that has none (e.g. dragged text). */
  getPathForFile: (file: File) => string;
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
  /** `projectId` is absent only from an older sender; then only the task is selected. */
  onFocusTask: (callback: (target: { taskId: string; projectId?: string }) => void) => () => void;
  /** An agent outside Dash asks to control it (`open`), or the ask timed out (`!open`). */
  onOrchestratorAccessRequest: (
    callback: (request: { id: string; open: boolean }) => void,
  ) => () => void;
  /** The person's Allow / Deny for an `onOrchestratorAccessRequest`. */
  answerOrchestratorAccess: (answer: { id: string; allowed: boolean }) => void;
  onToast: (callback: (data: { message: string; url?: string }) => void) => () => void;

  // Settings
  setDesktopNotification: (opts: { enabled: boolean }) => void;
  setCommitAttribution: (value: string | undefined) => void;
  setClaudeEnvVars: (vars: Record<string, string>) => void;
  setSyncShellEnv: (enabled: boolean) => void;
  setUltracode: (enabled: boolean) => void;
  /** `claude stop` every task session when Dash quits (default: sessions live on). */
  setStopSessionsOnQuit: (enabled: boolean) => void;
  /** Dash's theme, for sessions started with no pane (the control API). */
  setIsDark: (isDark: boolean) => void;
  /** Settings "Let other agents control Dash": gates orchestrator calls to the control API. */
  setOrchestratorAccess: (enabled: boolean) => void;
  getControlInfo: () => Promise<IpcResponse<ControlInfo>>;
  getClaudeAttribution: (projectPath?: string) => Promise<IpcResponse<string | null>>;
  /** Claude Code's `permissions.defaultMode` as a Dash mode; null when unset or unmatched. */
  getClaudeDefaultPermissionMode: (
    projectPath?: string,
  ) => Promise<IpcResponse<PermissionMode | null>>;
}
