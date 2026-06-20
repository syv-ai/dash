import type {
  IpcResponse,
  RtkStatus,
  RtkDownloadProgress,
  RtkTestResult,
} from '../../shared/types';

/** RTK (Rust Token Killer) — optional native helper: status, enable, download, test. */
export interface RtkApi {
  rtkGetStatus: () => Promise<IpcResponse<RtkStatus>>;
  rtkSetEnabled: (enabled: boolean) => Promise<IpcResponse<{ warning?: string }>>;
  rtkDownload: () => Promise<IpcResponse<{ warning?: string } | undefined>>;
  rtkTest: () => Promise<IpcResponse<RtkTestResult>>;
  onRtkDownloadProgress: (callback: (progress: RtkDownloadProgress) => void) => () => void;
}
