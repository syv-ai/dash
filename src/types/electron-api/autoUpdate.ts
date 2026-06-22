import type { IpcResponse } from '../../shared/types';

/** Electron auto-updater: check/download/install and its progress events. */
export interface AutoUpdateApi {
  autoUpdateCheck: () => Promise<IpcResponse<void>>;
  autoUpdateDownload: () => Promise<IpcResponse<void>>;
  autoUpdateQuitAndInstall: () => Promise<IpcResponse<void>>;
  autoUpdateGetEnabled: () => Promise<IpcResponse<boolean>>;
  autoUpdateSetEnabled: (enabled: boolean) => Promise<IpcResponse<void>>;
  autoUpdateGetStatus: () => Promise<
    IpcResponse<{
      state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready';
      availableVersion: string | null;
      initialized: boolean;
    }>
  >;
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
