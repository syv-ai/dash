import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  CancellationTokenSource,
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  type CancellationToken,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import type {
  ClientCapabilities,
  ConfigurationParams,
  Diagnostic,
  DocumentDiagnosticReport,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
  ServerCapabilities,
  ShowMessageParams,
  TextDocumentItem,
} from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { settingsSection, type ServerLaunch, type ServerSpec } from './serverRegistry';

/**
 * One language server process and its JSON-RPC connection: initialize, keep
 * the open documents in sync (replayed after every (re)start), answer the
 * server's own requests, normalise push and pull diagnostics into one
 * callback, restart after a crash with backoff, and shut down cleanly.
 *
 * Documents are owned by the caller (`documents()`), so a restarted or
 * replacement server is brought up to date without the caller noticing.
 */

export type ServerState = 'starting' | 'running' | 'restarting' | 'failed' | 'stopped';

export interface RestartPolicy {
  /** Crashes tolerated within `windowMs` before giving up. */
  maxRestarts: number;
  windowMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface LanguageServerOptions {
  spec: ServerSpec;
  launch: ServerLaunch;
  /** Realpath of the worktree: cwd and the workspace folder. */
  root: string;
  /** The documents to replay after (re)start, with server-side URIs. */
  documents: () => readonly TextDocumentItem[];
  /** `version` is the document version the diagnostics were computed for, when known. */
  onDiagnostics: (uri: string, version: number | undefined, diagnostics: Diagnostic[]) => void;
  onStateChange?: (state: ServerState, message?: string) => void;
  restart?: Partial<RestartPolicy>;
  /** Budget for shutdown → exit before SIGKILL. */
  shutdownTimeoutMs?: number;
  /** A server that hasn't answered initialize by then counts as crashed. */
  initializeTimeoutMs?: number;
}

const DEFAULT_RESTART: RestartPolicy = {
  maxRestarts: 4,
  windowMs: 3 * 60_000,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

const STDERR_TAIL_BYTES = 2048;
/** `LSPErrorCodes.RequestCancelled` (a runtime import of the protocol package needs its RAL). */
const REQUEST_CANCELLED = -32800;

export const CLIENT_CAPABILITIES: ClientCapabilities = {
  general: { positionEncodings: ['utf-16'] },
  workspace: {
    configuration: true,
    workspaceFolders: true,
    workspaceEdit: { documentChanges: true },
    diagnostics: { refreshSupport: true },
  },
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        labelDetailsSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      },
      contextSupport: true,
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
      contextSupport: true,
    },
    definition: { linkSupport: true },
    references: {},
    rename: { prepareSupport: true },
    publishDiagnostics: { versionSupport: true, relatedInformation: true },
    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
  },
  window: { workDoneProgress: true, showMessage: {} },
};

export class LanguageServer {
  private readonly opts: LanguageServerOptions;
  private readonly restartPolicy: RestartPolicy;
  private readonly events = new EventEmitter();
  private child: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private capabilities: ServerCapabilities = {};
  private stateValue: ServerState = 'stopped';
  private messageValue: string | undefined;
  private crashes: number[] = [];
  private restartTimer: NodeJS.Timeout | null = null;
  private disposing: Promise<void> | null = null;
  private stderrTail = '';
  /** Per-URI pull in flight, cancelled when a newer version supersedes it. */
  private readonly pulls = new Map<string, CancellationTokenSource>();

  constructor(opts: LanguageServerOptions) {
    this.opts = opts;
    this.restartPolicy = { ...DEFAULT_RESTART, ...opts.restart };
  }

  get state(): ServerState {
    return this.stateValue;
  }

  /** Why the server failed or is restarting, when it did. */
  get message(): string | undefined {
    return this.messageValue;
  }

  start(): void {
    if (this.stateValue !== 'stopped' || this.disposing) return;
    this.launch();
  }

  didOpen(doc: TextDocumentItem): void {
    if (!this.connection || this.stateValue !== 'running') return;
    void this.connection.sendNotification('textDocument/didOpen', { textDocument: doc });
    this.pullDiagnostics(doc.uri, doc.version);
  }

  /** Full-document sync: every server must accept a range-less change. */
  didChange(uri: string, version: number, text: string): void {
    if (!this.connection || this.stateValue !== 'running') return;
    void this.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
    this.pullDiagnostics(uri, version);
  }

  didClose(uri: string): void {
    this.pulls.get(uri)?.cancel();
    this.pulls.delete(uri);
    if (!this.connection || this.stateValue !== 'running') return;
    void this.connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
  }

  /** Waits for a starting/restarting server; rejects when it failed or stopped. */
  async request<R = unknown>(
    method: string,
    params: unknown,
    token?: CancellationToken,
  ): Promise<R> {
    await this.whenRunning();
    if (!this.connection) throw new Error(`${this.opts.spec.name} is not running`);
    // Cancelled while waiting: jsonrpc would send $/cancelRequest before the request itself.
    if (token?.isCancellationRequested) {
      throw new ResponseError(REQUEST_CANCELLED, 'Request cancelled');
    }
    return this.connection.sendRequest<R>(method, params, token);
  }

  /** shutdown → exit, SIGKILL when the budget runs out. Idempotent. */
  dispose(): Promise<void> {
    this.disposing ??= this.stop();
    return this.disposing;
  }

  /** Synchronous last resort for process exit: no handshake, just kill. */
  kill(): void {
    this.clearRestartTimer();
    this.child?.kill('SIGKILL');
  }

  private setState(state: ServerState, message?: string): void {
    this.stateValue = state;
    this.messageValue = message;
    this.opts.onStateChange?.(state, message);
    this.events.emit('state');
  }

  private whenRunning(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        if (this.stateValue === 'running') resolve();
        else if (this.stateValue === 'failed' || this.stateValue === 'stopped' || this.disposing)
          reject(
            new Error(`${this.opts.spec.name} is ${this.disposing ? 'stopped' : this.stateValue}`),
          );
        else return false;
        this.events.off('state', check);
        return true;
      };
      if (!check()) this.events.on('state', check);
    });
  }

  private launch(): void {
    const { launch, root } = this.opts;
    this.setState(this.crashes.length ? 'restarting' : 'starting', this.messageValue);
    this.stderrTail = '';
    const child = spawn(launch.command, launch.args, {
      cwd: root,
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });
    // A failed spawn (ENOENT, EACCES) emits 'error' and maybe no 'exit'.
    child.on('error', (err) => this.onExit(child, `could not start: ${err.message}`));
    child.on('exit', (code, signal) =>
      this.onExit(child, `exited (${signal ?? `code ${code ?? '?'}`})`),
    );
    child.stdin?.on('error', () => {
      // EPIPE on a dying server; the exit handler takes it from here.
    });

    if (!child.stdout || !child.stdin) return;
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.connection = connection;
    this.registerHandlers(connection);
    connection.listen();
    void this.initialize(child, connection);
  }

  private async initialize(child: ChildProcess, connection: MessageConnection): Promise<void> {
    const rootUri = URI.file(this.opts.root).toString();
    const params: InitializeParams = {
      processId: process.pid,
      clientInfo: { name: 'Dash' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: this.opts.root.split(/[\\/]/).pop() ?? rootUri }],
      capabilities: CLIENT_CAPABILITIES,
    };
    const timeoutMs = this.opts.initializeTimeoutMs ?? 30_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        connection.sendRequest<InitializeResult>('initialize', params),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('initialize timed out')), timeoutMs);
        }),
      ]);
      if (this.child !== child || this.disposing) return;
      this.capabilities = result.capabilities;
      await connection.sendNotification('initialized', {});
      // Replay and flip to running in one tick, so nothing opened meanwhile is missed or sent twice.
      for (const doc of this.opts.documents()) {
        void connection.sendNotification('textDocument/didOpen', { textDocument: doc });
      }
      this.setState('running');
      for (const doc of this.opts.documents()) this.pullDiagnostics(doc.uri, doc.version);
    } catch (err) {
      if (this.child !== child || this.disposing) return;
      console.warn(`[lsp:${this.opts.spec.id}] initialize failed:`, err);
      child.kill('SIGKILL');
    } finally {
      clearTimeout(timer);
    }
  }

  private registerHandlers(connection: MessageConnection): void {
    const tag = `[lsp:${this.opts.spec.id}]`;
    connection.onRequest('workspace/configuration', (params: ConfigurationParams) => {
      const settings = this.opts.spec.settings?.(this.opts.root);
      return params.items.map((item) => settingsSection(settings, item.section));
    });
    // Accept dynamic registrations (TS 7 registers didChangeConfiguration); nothing to wire.
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('client/unregisterCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.onRequest('window/showMessageRequest', (params: ShowMessageParams) => {
      console.log(`${tag} ${params.message}`);
      return null;
    });
    connection.onRequest('workspace/diagnostic/refresh', () => {
      for (const doc of this.opts.documents()) this.pullDiagnostics(doc.uri, doc.version);
      return null;
    });
    // Edits are applied by the renderer from the rename result, never pushed by a server.
    connection.onRequest('workspace/applyEdit', () => ({ applied: false }));
    connection.onNotification('window/logMessage', (params: ShowMessageParams) => {
      if (params.type <= 2) console.warn(`${tag} ${params.message}`);
    });
    connection.onNotification('window/showMessage', (params: ShowMessageParams) => {
      console.log(`${tag} ${params.message}`);
    });
    connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: PublishDiagnosticsParams) => {
        this.opts.onDiagnostics(params.uri, params.version, params.diagnostics);
      },
    );
    connection.onError(([err]) => console.warn(`${tag} connection error:`, err.message));
  }

  /**
   * Servers with `diagnosticProvider` (TS 7) only answer pulls; others push.
   * A newer version cancels the older pull, so results arrive in order.
   */
  private pullDiagnostics(uri: string, version: number): void {
    const connection = this.connection;
    if (!connection || !this.capabilities.diagnosticProvider) return;
    this.pulls.get(uri)?.cancel();
    const source = new CancellationTokenSource();
    this.pulls.set(uri, source);
    connection
      .sendRequest<DocumentDiagnosticReport>(
        'textDocument/diagnostic',
        { textDocument: { uri } },
        source.token,
      )
      .then((report) => {
        if (source.token.isCancellationRequested || report.kind !== 'full') return;
        this.opts.onDiagnostics(uri, version, report.items);
      })
      .catch(() => {
        // Cancelled, superseded or the server went away.
      })
      .finally(() => {
        if (this.pulls.get(uri) === source) this.pulls.delete(uri);
      });
  }

  private onExit(child: ChildProcess, why: string): void {
    if (this.child !== child) return; // An earlier incarnation, or already handled.
    this.child = null;
    this.connection?.dispose();
    this.connection = null;
    for (const source of this.pulls.values()) source.cancel();
    this.pulls.clear();
    if (this.disposing) return;

    const now = Date.now();
    const { maxRestarts, windowMs, baseDelayMs, maxDelayMs } = this.restartPolicy;
    this.crashes = [...this.crashes.filter((t) => now - t < windowMs), now];
    const detail = this.stderrTail.trim().split('\n').pop();
    const message = `${this.opts.spec.name} ${why}${detail ? `: ${detail}` : ''}`;
    console.warn(`[lsp:${this.opts.spec.id}] ${message}`);
    if (this.crashes.length > maxRestarts) {
      this.setState('failed', message);
      return;
    }
    this.setState('restarting', message);
    const delay = Math.min(baseDelayMs * 2 ** (this.crashes.length - 1), maxDelayMs);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.disposing) this.launch();
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private async stop(): Promise<void> {
    this.clearRestartTimer();
    const child = this.child;
    const connection = this.connection;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.child = null;
      this.setState('stopped');
      return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const budget = this.opts.shutdownTimeoutMs ?? 2_000;
    const killTimer = setTimeout(() => child.kill('SIGKILL'), budget);
    try {
      if (connection && this.stateValue === 'running') {
        await Promise.race([
          connection.sendRequest('shutdown'),
          new Promise((resolve) => setTimeout(resolve, budget / 2)),
        ]);
        await connection.sendNotification('exit');
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      child.kill('SIGKILL');
    }
    await exited;
    clearTimeout(killTimer);
    this.connection?.dispose();
    this.connection = null;
    this.setState('stopped');
  }
}
