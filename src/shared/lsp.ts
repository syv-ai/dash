import type { Diagnostic } from 'vscode-languageserver-protocol';

/** Requests the renderer may send to a language server (`lsp:request`). */
export const LSP_REQUEST_METHODS = [
  'textDocument/completion',
  'completionItem/resolve',
  'textDocument/hover',
  'textDocument/signatureHelp',
  'textDocument/definition',
  'textDocument/references',
  'textDocument/prepareRename',
  'textDocument/rename',
] as const;

export type LspRequestMethod = (typeof LSP_REQUEST_METHODS)[number];

/** `lsp:diagnostics` push: the full set for one document, for the version it was computed on. */
export interface LspDiagnosticsEvent {
  uri: string;
  version: number;
  diagnostics: Diagnostic[];
}

export type LspServerState =
  | 'starting'
  | 'running'
  | 'restarting'
  | 'failed'
  | 'stopped'
  /** No executable (e.g. gopls not on PATH); `message` says why. */
  | 'unavailable';

export interface LspServerStatus {
  serverId: string;
  name: string;
  state: LspServerState;
  message?: string;
  /** Where the executable came from. */
  source?: 'workspace' | 'bundled' | 'path';
}

/** `lsp:status` push and invoke result: every server Dash runs for one worktree. */
export interface LspStatusEvent {
  worktree: string;
  servers: LspServerStatus[];
}
