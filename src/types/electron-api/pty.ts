import type {
  IpcResponse,
  PermissionMode,
  TerminalSnapshot,
  ActivityInfo,
  RemoteControlState,
  StatusLineData,
} from '../../shared/types';

/** node-pty terminal lifecycle plus the per-PTY observation channels layered on
 *  top of it: activity state, remote control, status line, and snapshots. */
export interface PtyApi {
  // Spawn / IO
  ptyStartDirect: (args: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
    permissionMode?: PermissionMode;
    isDark?: boolean;
  }) => Promise<
    IpcResponse<{
      reattached: boolean;
      isDirectSpawn: boolean;
      /** Supervisor job the pane is attached to. */
      jobId: string;
    }>
  >;
  ptyStart: (args: {
    id: string;
    cwd: string;
    cols: number;
    rows: number;
  }) => Promise<
    IpcResponse<{ reattached: boolean; isDirectSpawn: boolean; serializedState?: string }>
  >;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows: number }) => void;
  ptyKill: (id: string) => void;
  ptyKillAwait: (id: string) => Promise<IpcResponse<void>>;
  /** Put the task to sleep: `claude stop` its supervisor job and kill the
   *  attach client. The next ptyStartDirect resumes the same session. */
  ptyStopSession: (taskId: string) => Promise<IpcResponse<void>>;
  /** Stop + forget the task's supervisor job; the next ptyStartDirect resumes
   *  the same session in a fresh job (picks up env/ports changes). */
  ptyRestartSession: (taskId: string) => Promise<IpcResponse<void>>;
  ptyListForTask: (
    taskId: string,
    opts?: { kinds?: ('agent' | 'shell' | 'service')[]; featureId?: string },
  ) => Promise<IpcResponse<string[]>>;
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

  // Task context for the SessionStart hook
  ptyWriteTaskContext: (args: { taskId: string; prompt: string }) => Promise<IpcResponse<void>>;
  // Initial prompt the first `claude` spawn auto-submits (one-shot)
  ptySetInitialPrompt: (args: { taskId: string; prompt: string }) => Promise<IpcResponse<void>>;
}
