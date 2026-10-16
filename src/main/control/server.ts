import * as http from 'http';
import * as fs from 'fs';
import { parseCaller, type Caller } from './callers';
import { controlPaths, type ControlPaths } from './paths';
import { ControlError, type Registry } from './registry';
import { verify } from './tokens';

/** Maximum JSON body size for a control call (64KB), as for hook payloads. */
const MAX_BODY_BYTES = 65_536;

export const ORCHESTRATOR_ACCESS_OFF = 'orchestrator access is off in Dash settings';

export interface ControlServerOptions {
  userDataDir: string;
  registry: Registry;
  /** Read per request: the Settings switch can flip while Dash runs. */
  isOrchestratorAllowed: () => boolean;
}

/**
 * The control API over HTTP on 127.0.0.1. The `dash-mcp` shim finds it
 * through the `control-port` file, the way hooks find `hook-port`.
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

    const caller = this.authenticate(req);
    if (!caller) return sendJson(res, 401, { error: 'unauthorized' });
    if (caller.kind === 'orchestrator' && !this.opts.isOrchestratorAllowed()) {
      return sendJson(res, 403, { error: ORCHESTRATOR_ACCESS_OFF });
    }

    const pathname = new URL(req.url || '/', `http://127.0.0.1:${this._port}`).pathname;

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
      return this.respond(res, async () => ({
        result: await this.opts.registry.call(caller, name, input),
      }));
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

  private async respond(res: http.ServerResponse, fn: () => unknown): Promise<void> {
    try {
      sendJson(res, 200, (await fn()) ?? null);
    } catch (err) {
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

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body === undefined ? null : body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

type BodyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/** Read a JSON object body, enforcing the size limit. */
function readJsonBody(req: http.IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: BodyResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering but keep draining, so the 413 reaches the client
        // instead of a reset socket.
        finish({ ok: false, status: 413, error: 'payload too large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => finish({ ok: false, status: 400, error: 'bad request' }));
    req.on('end', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return finish({ ok: false, status: 400, error: 'invalid JSON' });
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return finish({ ok: false, status: 400, error: 'expected a JSON object' });
      }
      finish({ ok: true, data: parsed as Record<string, unknown> });
    });
  });
}
