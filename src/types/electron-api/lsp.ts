import type { IpcResponse } from '../../shared/types';
import type { LspDiagnosticsEvent, LspRequestMethod, LspStatusEvent } from '../../shared/lsp';

/** Language servers run by main, per task worktree. Contract: `src/main/ipc/lspIpc.ts`. */
export interface LspApi {
  /** Track a document and start its server; `serverId` is null when no server handles the file. */
  lspOpen: (args: {
    worktree: string;
    uri: string;
    version: number;
    text: string;
  }) => Promise<IpcResponse<{ serverId: string | null }>>;
  /** Full-text sync; `version` strictly increasing. Fire-and-forget. */
  lspChange: (args: { uri: string; version: number; text: string }) => void;
  lspClose: (args: { uri: string }) => void;
  /** The LSP result (worktree URIs in the form `lspOpen` used). Fails with code CANCELLED, UNAVAILABLE or NOT_FOUND. */
  lspRequest: (args: {
    uri: string;
    method: LspRequestMethod;
    params: Record<string, unknown>;
    requestId: string | number;
  }) => Promise<IpcResponse<unknown>>;
  lspCancel: (args: { requestId: string | number }) => void;
  lspStatus: (args: { worktree: string }) => Promise<IpcResponse<LspStatusEvent>>;
  /** Diagnostics for a document this window opened; drop when `version` is older than the model's. */
  onLspDiagnostics: (callback: (event: LspDiagnosticsEvent) => void) => () => void;
  onLspStatus: (callback: (event: LspStatusEvent) => void) => () => void;
}
