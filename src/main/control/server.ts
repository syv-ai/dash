import * as http from 'http';
import * as fs from 'fs';
import { parseCaller, type Caller } from './callers';
import { controlPaths, type ControlPaths } from './paths';
import { ControlError, type Registry, type StreamSink } from './registry';
import { runCli, type BuildInfo } from './cli';
import { verify } from './tokens';
import { ORCHESTRATOR_ACCESS_OFF } from './scope';

/** Maximum JSON body size for a control call (64KB), as for hook payloads. */
const MAX_BODY_BYTES = 65_536;
/** A `dashctl` run's form body: a 64KB comment grows when percent-encoded. */
const MAX_CLI_BODY_BYTES = 262_144;

export interface ControlServerOptions {
  userDataDir: string;
  registry: Registry;
  /**
   * Read per request: the Settings switch can flip while Dash runs. The
   * registry's scope checks it too (and again during a stream); this one
   * answers before anything else is read.
   */
  isOrchestratorAllowed: () => boolean;
  /** Asks the person in Dash to turn orchestrator access on; true once it is. */
  requestOrchestratorAccess: () => Promise<boolean>;
  /** What `dashctl version` prints. */
  build: BuildInfo;
}

/**
 * The control API over HTTP on 127.0.0.1. `dashctl` finds it through the
 * `control-port` file, the way hooks find `hook-port`.
 *
 * Trust boundary is the local user; the Host and Origin checks only block
 * browser-based attacks (DNS rebinding, CSRF).
 */
export class ControlServer {
  private server: http.Server | null = null;
  private _port = 0;
  private readonly paths: ControlPaths;

  constructor(private readonly opts: ControlServerOptions) {
    this.paths = controlPaths(opts.userDataDir);
  }

  get port(): number {
    return this._port;
  }

  async start(): Promise<number> {
    if (this.server) return this._port;
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error('[ControlServer] Request handler error:', err);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      });
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const addr = server.address();
    if (!addr || typeof addr !== 'object') throw new Error('Failed to get control server address');
    this._port = addr.port;
    this.writePortFile();
    console.error(`[ControlServer] Listening on 127.0.0.1:${this._port}`);
    return this._port;
  }

  async stop(): Promise<void> {
    this.removePortFile();
    const server = this.server;
    this.server = null;
    this._port = 0;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${this._port}` && host !== `localhost:${this._port}`) {
      return sendJson(res, 403, { error: 'bad host' });
    }
    if (req.headers.origin !== undefined) {
      return sendJson(res, 403, { error: 'browser requests are not allowed' });
    }

    const pathname = new URL(req.url || '/', `http://127.0.0.1:${this._port}`).pathname;

    // `dashctl` from outside Dash, finding no orchestrator token: ask the
    // person in Dash. No token here, by design; it waits for their answer.
    if (pathname === '/v1/access') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const allowed = await this.opts.requestOrchestratorAccess();
      return allowed
        ? sendText(res, 200, 'allowed')
        : sendText(res, 403, `dashctl: ${ORCHESTRATOR_ACCESS_OFF}`);
    }

    const caller = this.authenticate(req);
    if (!caller) return sendJson(res, 401, { error: 'unauthorized' });
    if (caller.kind === 'orchestrator' && !this.opts.isOrchestratorAllowed()) {
      return sendJson(res, 403, { error: ORCHESTRATOR_ACCESS_OFF });
    }

    if (pathname === '/v1/capabilities') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return this.respond(res, () => ({ capabilities: this.opts.registry.listFor(caller) }));
    }

    if (pathname === '/v1/call') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { error: body.error });
      const { name, input } = body.data;
      if (typeof name !== 'string' || !name) {
        return sendJson(res, 400, { error: 'expected {name, input}' });
      }
      const stream = new NdjsonStream(res);
      return this.respond(
        res,
        async () => ({ result: await this.opts.registry.call(caller, name, input, stream) }),
        stream,
      );
    }

    // `dashctl`: argv and the caller's cwd (and stdin, once asked for) as a
    // form; the answer is text, its status telling the script where to print
    // it (cli.ts). A script that can print a stream says so in its Accept
    // header; an older one is refused a stream command rather than left
    // buffering one that never ends.
    if (pathname === '/v1/cli') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      const body = await readBody(req, MAX_CLI_BODY_BYTES);
      if (!body.ok) return sendText(res, body.status, `dashctl: ${body.error}`);
      const form = new URLSearchParams(body.text);
      const cwd = form.get('cwd');
      if (!cwd) return sendText(res, 400, 'dashctl: no cwd');
      const stream = acceptsNdjson(req) ? new NdjsonStream(res) : undefined;
      try {
        const answer = await runCli(this.opts.registry, caller, {
          argv: form.getAll('argv'),
          stdin: form.has('stdin') ? form.get('stdin') : null,
          cwd,
          build: this.opts.build,
          stream,
        });
        if (stream?.started) return stream.end(answer.status === 200 ? undefined : answer.text);
        return sendText(res, answer.status, answer.text);
      } catch (err) {
        const message = `dashctl: ${err instanceof Error ? err.message : String(err)}`;
        if (stream?.started) return stream.end(message);
        if (err instanceof ControlError) return sendText(res, err.status, message);
        throw err;
      }
    }

    sendJson(res, 404, { error: 'not found' });
  }

  private authenticate(req: http.IncomingMessage): Caller | null {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
    const rawCaller = req.headers['x-dash-caller'];
    const caller = parseCaller(typeof rawCaller === 'string' ? rawCaller : undefined);
    if (!caller) return null;
    return verify(auth.slice('Bearer '.length).trim(), caller) ? caller : null;
  }

  private async respond(
    res: http.ServerResponse,
    fn: () => unknown,
    stream?: NdjsonStream,
  ): Promise<void> {
    try {
      const result = await fn();
      if (stream?.started) return stream.end();
      sendJson(res, 200, result ?? null);
    } catch (err) {
      if (stream?.started) return stream.end(err instanceof Error ? err.message : String(err));
      if (err instanceof ControlError) {
        sendJson(res, err.status, {
          error: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        });
        return;
      }
      throw err;
    }
  }

  private writePortFile(): void {
    try {
      fs.mkdirSync(this.paths.dir, { recursive: true });
      fs.writeFileSync(this.paths.port, `${this._port}\n`);
    } catch (err) {
      console.error('[ControlServer] Failed to write the control port file:', err);
    }
  }

  private removePortFile(): void {
    try {
      fs.rmSync(this.paths.port, { force: true });
    } catch {
      // Best effort — a stale file is overwritten on the next start.
    }
  }
}

/**
 * What a `stream` capability answers on: 200 application/x-ndjson, chunked, a
 * line written as soon as it is emitted. Nothing is sent before the first
 * line, so a refusal until then keeps its status. Its signal fires when the
 * connection closes: the client went away, or stop() closed every connection.
 */
class NdjsonStream implements StreamSink {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  started = false;

  constructor(private readonly res: http.ServerResponse) {
    res.on('close', () => this.controller.abort());
  }

  emit(line: unknown): void {
    if (this.signal.aborted || this.res.writableEnded) return;
    if (!this.started) {
      this.started = true;
      this.res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
    }
    this.res.write(`${JSON.stringify(line ?? null)}\n`);
  }

  /** Ends a started stream; an error after the first line is its last line. */
  end(error?: string): void {
    if (error !== undefined) this.emit({ error });
    if (!this.res.writableEnded) this.res.end();
  }
}

/** The client can read application/x-ndjson as it comes (today's dashctl). */
function acceptsNdjson(req: http.IncomingMessage): boolean {
  return (req.headers.accept ?? '').includes('application/x-ndjson');
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body === undefined ? null : body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

type BodyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

type TextResult = { ok: true; text: string } | { ok: false; status: number; error: string };

/** Read a JSON object body, enforcing the size limit. */
async function readJsonBody(req: http.IncomingMessage): Promise<BodyResult> {
  const body = await readBody(req, MAX_BODY_BYTES);
  if (!body.ok) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'expected a JSON object' };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}

/** Read a body as UTF-8 text, enforcing `maxBytes`. */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<TextResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: TextResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Stop buffering but keep draining, so the 413 reaches the client
        // instead of a reset socket.
        finish({ ok: false, status: 413, error: 'payload too large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => finish({ ok: false, status: 400, error: 'bad request' }));
    req.on('end', () => finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') }));
  });
}
