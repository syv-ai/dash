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
    /** Owning task id when it differs from the PTY id (loop:/mgr: composite ids). */
    taskId?: string;
    /** Skip --resume: spawn a fresh Claude session (loop agents; Ralph reset). */
    freshContext?: boolean;
    /** Prompt auto-submitted after the trust gate (loop worker/manager seed). */
    initialPrompt?: string;
  }) => Promise<
    IpcResponse<{
      reattached: boolean;
      isDirectSpawn: boolean;
      /** Serialized mirror state (main-process headless xterm) on reattach. */
      serializedState?: string;
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
  ptyListForTask: (
    taskId: string,
    opts?: { kinds?: ('agent' | 'shell' | 'tui' | 'service')[]; featureId?: string },
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
}
