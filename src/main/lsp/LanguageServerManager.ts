import * as fs from 'fs';
import * as path from 'path';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { Diagnostic, TextDocumentItem } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { IpcError } from '../ipc/ipcErrors';
import type { LspDiagnosticsEvent, LspServerStatus } from '@shared/lsp';
import { LanguageServer, type RestartPolicy } from './LanguageServer';
import {
  defaultResolveEnv,
  SERVER_SPECS,
  specForFile,
  type ResolveEnv,
  type ServerSpec,
} from './serverRegistry';

/**
 * Every language server Dash runs, keyed by (realpath worktree, server id).
 *
 * - Lazy: a server starts on the first document opened for it.
 * - Documents live here, not in the server: a restarted, evicted or replaced
 *   server is brought up to date by replaying them, so eviction is invisible
 *   to the editor beyond a cold start.
 * - Idle: a server with no open documents stops after `idleMs`.
 * - LRU: at most `maxServers` run; starting one more stops the least recently
 *   used, preferring servers with no open documents.
 * - Owners: each document belongs to the renderer (webContents id) that opened
 *   it, and only that renderer gets its diagnostics.
 *
 * Renderer URIs are kept as given; servers see the realpath'd form (a worktree
 * under a symlink would otherwise be outside the server's own workspace), and
 * every URI under the realpath'd root in a result or diagnostic is mapped back
 * to the worktree's form, so the renderer only ever sees its own URIs.
 */

export interface LanguageServerManagerOptions {
  specs?: readonly ServerSpec[];
  resolveEnv?: () => ResolveEnv;
  idleMs?: number;
  maxServers?: number;
  restart?: Partial<RestartPolicy>;
  shutdownTimeoutMs?: number;
  onDiagnostics: (owner: number, event: LspDiagnosticsEvent) => void;
  onStatus?: (worktree: string, servers: LspServerStatus[]) => void;
  /** A server gave up after its restarts (analytics: the spec id only). */
  onFailed?: (serverId: string) => void;
}

export interface OpenDocumentArgs {
  /** The task's worktree path as Dash stores it. */
  worktree: string;
  uri: string;
  version: number;
  text: string;
}

interface OpenDoc {
  owner: number;
  clientUri: string;
  serverUri: string;
  spec: ServerSpec;
  root: string;
  worktree: string;
  key: string;
  languageId: string;
  version: number;
  text: string;
}

interface ServerEntry {
  key: string;
  root: string;
  worktree: string;
  spec: ServerSpec;
  /** Null when the server can't be resolved (status `unavailable`). */
  server: LanguageServer | null;
  unavailable?: string;
  source?: LspServerStatus['source'];
  lastUsed: number;
  idleTimer: NodeJS.Timeout | null;
}

function realpath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

const keyOf = (root: string, specId: string): string => `${root}\0${specId}`;

/**
 * `value` with every string (and object key: a WorkspaceEdit's `changes` is
 * keyed by URI) that starts with `from` re-rooted at `to`. Both are directory
 * URIs ending in `/`. Hover markdown linking into the worktree is mapped too.
 */
export function rerootUris<T>(value: T, from: string, to: string): T {
  if (from === to) return value;
  const map = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith(from) ? to + v.slice(from.length) : v;
    if (Array.isArray(v)) return v.map(map);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [map(k) as string, map(x)]));
    }
    return v;
  };
  return map(value) as T;
}

/** The directory URI prefix of `dir` (`file:///a/b/`). */
const dirUri = (dir: string): string => URI.file(dir).toString().replace(/\/*$/, '/');

export class LanguageServerManager {
  private readonly opts: LanguageServerManagerOptions;
  private readonly specs: readonly ServerSpec[];
  private readonly entries = new Map<string, ServerEntry>();
  private readonly docs = new Map<string, OpenDoc>();
  private readonly pending = new Map<string, CancellationTokenSource>();
  private clock = 0;

  constructor(opts: LanguageServerManagerOptions) {
    this.opts = opts;
    this.specs = opts.specs ?? SERVER_SPECS;
  }

  /**
   * Track a document and start its server if needed. Returns the serving
   * server's id, or null when no server handles the file (nothing tracked).
   * Re-opening a tracked URI closes and reopens it (also the retry for a failed server).
   */
  open(owner: number, args: OpenDocumentArgs): { serverId: string | null } {
    const fsPath = URI.parse(args.uri).fsPath;
    const match = specForFile(fsPath, this.specs);
    if (!match) return { serverId: null };
    const root = realpath(args.worktree);
    const key = keyOf(root, match.spec.id);
    this.close(args.uri);

    const doc: OpenDoc = {
      owner,
      clientUri: args.uri,
      // The IPC layer checked `fsPath` is inside the worktree.
      serverUri: URI.file(path.join(root, path.relative(args.worktree, fsPath))).toString(),
      spec: match.spec,
      root,
      worktree: args.worktree,
      key,
      languageId: match.languageId,
      version: args.version,
      text: args.text,
    };
    this.docs.set(args.uri, doc);
    const entry = this.ensureEntry(key, root, args.worktree, match.spec, { retryFailed: true });
    entry.server?.didOpen(this.item(doc));
    return { serverId: match.spec.id };
  }

  change(args: { uri: string; version: number; text: string }): void {
    const doc = this.requireDoc(args.uri);
    doc.version = args.version;
    doc.text = args.text;
    // An evicted server comes back here and replays the new text itself.
    const { entry, created } = this.liveEntry(doc);
    if (!created) entry.server?.didChange(doc.serverUri, doc.version, doc.text);
  }

  close(uri: string): void {
    const doc = this.docs.get(uri);
    if (!doc) return;
    this.docs.delete(uri);
    const entry = this.entries.get(doc.key);
    entry?.server?.didClose(doc.serverUri);
    if (entry && this.docCount(entry.key) === 0) this.armIdle(entry);
  }

  /** A renderer went away: close everything it had open and cancel its requests. */
  closeOwner(owner: number): void {
    for (const doc of [...this.docs.values()]) if (doc.owner === owner) this.close(doc.clientUri);
    for (const [id, source] of this.pending) {
      if (id.startsWith(`${owner}:`)) source.cancel();
    }
  }

  /** Send `method` to the server of the open document `uri`. */
  async request(
    owner: number,
    args: { uri: string; method: string; params: Record<string, unknown>; requestId: string },
  ): Promise<unknown> {
    const doc = this.requireDoc(args.uri);
    const { entry } = this.liveEntry(doc);
    if (!entry.server) throw new IpcError(entry.unavailable ?? 'No server', 'UNAVAILABLE');
    const pendingId = `${owner}:${args.requestId}`;
    const source = new CancellationTokenSource();
    this.pending.get(pendingId)?.cancel();
    this.pending.set(pendingId, source);
    const server = entry.server;
    const cancelled = () => new IpcError('Request cancelled', 'CANCELLED');
    try {
      const result = await server.request(
        args.method,
        this.toServerParams(doc, args.params),
        source.token,
      );
      // A server may still answer a cancelled request; the caller has moved on.
      if (source.token.isCancellationRequested) throw cancelled();
      return this.toClientForm(doc, result);
    } catch (err) {
      if (err instanceof IpcError) throw err;
      if (source.token.isCancellationRequested) throw cancelled();
      if (server.state === 'failed' || server.state === 'stopped') {
        throw new IpcError(
          server.message ?? `${entry.spec.name} is ${server.state}`,
          'UNAVAILABLE',
        );
      }
      throw err;
    } finally {
      if (this.pending.get(pendingId) === source) this.pending.delete(pendingId);
    }
  }

  /** `$/cancelRequest` for a request this owner started. */
  cancel(owner: number, requestId: string): void {
    this.pending.get(`${owner}:${requestId}`)?.cancel();
  }

  status(worktree: string): LspServerStatus[] {
    const root = realpath(worktree);
    return [...this.entries.values()]
      .filter((e) => e.root === root || e.worktree === worktree)
      .map((e) => this.entryStatus(e));
  }

  /** A task was archived or deleted: stop its servers and forget its documents. */
  async disposeWorktree(worktree: string): Promise<void> {
    const root = realpath(worktree);
    const matches = [...this.entries.values()].filter(
      (e) => e.root === root || e.worktree === worktree,
    );
    const keys = new Set(matches.map((e) => e.key));
    for (const doc of [...this.docs.values()])
      if (keys.has(doc.key)) this.docs.delete(doc.clientUri);
    await Promise.all(matches.map((e) => this.stopEntry(e)));
  }

  /** App quit: every server gets its shutdown handshake, in parallel. */
  async shutdownAll(): Promise<void> {
    this.docs.clear();
    await Promise.all([...this.entries.values()].map((e) => this.stopEntry(e)));
  }

  /** Synchronous last resort (process exit): kill whatever is still running. */
  killAll(): void {
    for (const entry of this.entries.values()) entry.server?.kill();
  }

  private requireDoc(uri: string): OpenDoc {
    const doc = this.docs.get(uri);
    if (!doc) throw new IpcError(`Document is not open: ${uri}`, 'NOT_FOUND');
    return doc;
  }

  private docCount(key: string): number {
    let n = 0;
    for (const doc of this.docs.values()) if (doc.key === key) n++;
    return n;
  }

  private item(doc: OpenDoc): TextDocumentItem {
    return { uri: doc.serverUri, languageId: doc.languageId, version: doc.version, text: doc.text };
  }

  /** The doc's server entry, (re)created when it was evicted or stopped idle. */
  private liveEntry(doc: OpenDoc): { entry: ServerEntry; created: boolean } {
    const existing = this.entries.get(doc.key);
    if (existing) {
      this.touch(existing);
      return { entry: existing, created: false };
    }
    const entry = this.ensureEntry(doc.key, doc.root, doc.worktree, doc.spec, {});
    return { entry, created: true };
  }

  private ensureEntry(
    key: string,
    root: string,
    worktree: string,
    spec: ServerSpec,
    { retryFailed = false }: { retryFailed?: boolean },
  ): ServerEntry {
    const existing = this.entries.get(key);
    const stale =
      existing && retryFailed && (existing.unavailable || existing.server?.state === 'failed');
    if (existing && !stale) {
      this.touch(existing);
      return existing;
    }
    if (existing) {
      this.entries.delete(key);
      void existing.server?.dispose();
    }

    const resolution = spec.resolve(root, (this.opts.resolveEnv ?? defaultResolveEnv)());
    const entry: ServerEntry = {
      key,
      root,
      worktree,
      spec,
      server: null,
      lastUsed: 0,
      idleTimer: null,
    };
    if (!resolution.ok) {
      entry.unavailable = resolution.reason;
      this.entries.set(key, entry);
      this.emitStatus(entry);
      return entry;
    }
    this.evictForRoom();
    entry.source = resolution.launch.source;
    entry.server = new LanguageServer({
      spec,
      launch: resolution.launch,
      root,
      restart: this.opts.restart,
      shutdownTimeoutMs: this.opts.shutdownTimeoutMs,
      documents: () =>
        [...this.docs.values()].filter((d) => d.key === key).map((d) => this.item(d)),
      onDiagnostics: (uri, version, diagnostics) =>
        this.routeDiagnostics(key, uri, version, diagnostics),
      onStateChange: (state) => {
        if (state === 'failed') this.opts.onFailed?.(spec.id);
        this.emitStatus(entry);
      },
    });
    this.entries.set(key, entry);
    this.touch(entry);
    entry.server.start();
    return entry;
  }

  private touch(entry: ServerEntry): void {
    entry.lastUsed = ++this.clock;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    if (this.docCount(entry.key) === 0) this.armIdle(entry);
  }

  private armIdle(entry: ServerEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(
      () => {
        entry.idleTimer = null;
        if (this.docCount(entry.key) === 0) void this.stopEntry(entry);
      },
      this.opts.idleMs ?? 5 * 60_000,
    );
  }

  private evictForRoom(): void {
    const max = this.opts.maxServers ?? 4;
    const running = [...this.entries.values()].filter((e) => e.server);
    if (running.length < max) return;
    const byAge = running.sort((a, b) => a.lastUsed - b.lastUsed);
    const victim = byAge.find((e) => this.docCount(e.key) === 0) ?? byAge[0];
    if (victim) void this.stopEntry(victim);
  }

  private async stopEntry(entry: ServerEntry): Promise<void> {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    // A server reports its own `stopped`; an unavailable entry has none to.
    if (entry.server) await entry.server.dispose();
    else this.emitStatus(entry);
  }

  private routeDiagnostics(
    key: string,
    serverUri: string,
    version: number | undefined,
    diagnostics: Diagnostic[],
  ): void {
    for (const doc of this.docs.values()) {
      if (doc.key !== key || doc.serverUri !== serverUri) continue;
      this.opts.onDiagnostics(doc.owner, {
        uri: doc.clientUri,
        version: version ?? doc.version,
        // relatedInformation points at other files.
        diagnostics: this.toClientForm(doc, diagnostics),
      });
      return;
    }
  }

  /** Point `textDocument.uri` at the server's form of the document. */
  private toServerParams(doc: OpenDoc, params: Record<string, unknown>): Record<string, unknown> {
    const td = params.textDocument as { uri?: unknown } | undefined;
    if (!td || td.uri !== doc.clientUri) return params;
    return { ...params, textDocument: { ...td, uri: doc.serverUri } };
  }

  /** URIs under the server's realpath root, back in the worktree's form. */
  private toClientForm<T>(doc: OpenDoc, value: T): T {
    return doc.root === doc.worktree
      ? value
      : rerootUris(value, dirUri(doc.root), dirUri(doc.worktree));
  }

  private entryStatus(entry: ServerEntry): LspServerStatus {
    return {
      serverId: entry.spec.id,
      name: entry.spec.name,
      state: entry.server?.state ?? 'unavailable',
      message: entry.unavailable ?? entry.server?.message,
      source: entry.source,
    };
  }

  private emitStatus(entry: ServerEntry): void {
    this.emitWorktreeStatus(entry.root, entry.worktree);
  }

  private emitWorktreeStatus(root: string, worktree: string): void {
    if (!this.opts.onStatus) return;
    const servers = [...this.entries.values()]
      .filter((e) => e.root === root)
      .map((e) => this.entryStatus(e));
    this.opts.onStatus(worktree, servers);
  }
}
