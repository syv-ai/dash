import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { controlPaths } from '../paths';
import { shellQuote } from '../../../shared/shellQuote';
import { launcherScript, writeLauncher } from '../launcher';

/**
 * Drives the bundled `dash-mcp` shim over stdio, as Claude Code does, against
 * a fake control server. Runs under Electron's Node (pnpm test), so
 * process.execPath + ELECTRON_RUN_AS_NODE is how the launcher runs it too.
 */

let buildDir: string;
let shimPath: string;

beforeAll(async () => {
  buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-mcp-build-'));
  shimPath = path.join(buildDir, 'dash-mcp.js');
  await build({
    entryPoints: [path.resolve(__dirname, '../../scripts/dash-mcp.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: shimPath,
    logLevel: 'silent',
  });
}, 30_000);

afterAll(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
});

interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

const capabilities = [
  {
    name: 'projects.list',
    summary: 'List projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tasks.create',
    summary: 'Create a task',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, prompt: { type: 'string' } },
      required: ['projectId'],
    },
  },
];

/** A stand-in for ControlServer: records requests, answers with `reply`. */
function startFakeServer(
  userData: string,
  reply: (req: Recorded) => { status: number; body: unknown },
): Promise<{ requests: Recorded[]; close: () => Promise<void> }> {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const recorded: Recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(recorded);
      const { status, body } = reply(recorded);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const paths = controlPaths(userData);
      fs.mkdirSync(paths.dir, { recursive: true });
      fs.writeFileSync(paths.port, `${addr.port}\n`);
      resolve({
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function defaultReply(req: Recorded): { status: number; body: unknown } {
  if (req.url === '/v1/capabilities') return { status: 200, body: { capabilities } };
  if (req.url === '/v1/call') return { status: 200, body: { result: { ok: true, got: req.body } } };
  return { status: 404, body: { error: 'not found' } };
}

let userData: string;
let client: Client | null;
let fake: { requests: Recorded[]; close: () => Promise<void> } | null;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-mcp-'));
  fs.mkdirSync(controlPaths(userData).dir, { recursive: true });
  fs.writeFileSync(controlPaths(userData).orchestratorToken, 'orch-token\n');
  client = null;
  fake = null;
});

afterEach(async () => {
  await client?.close();
  await fake?.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

async function connect(env: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [shimPath],
    env: {
      PATH: process.env.PATH ?? '',
      ELECTRON_RUN_AS_NODE: '1',
      DASH_USER_DATA_DIR: userData,
      DASH_MCP_POLL_MS: '50',
      ...env,
    },
    stderr: 'pipe',
  });
  client = new Client({ name: 'shim-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content.map((c) => c.text).join('');
}

describe('dash-mcp shim', () => {
  it('advertises listChanged and maps capabilities to tools with _ names', async () => {
    fake = await startFakeServer(userData, defaultReply);
    const c = await connect();
    expect(c.getServerCapabilities()?.tools?.listChanged).toBe(true);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(['projects_list', 'tasks_create']);
    expect(tools[1]?.description).toBe('Create a task');
    expect(tools[1]?.inputSchema).toEqual(capabilities[1]?.inputSchema);
  });

  it('forwards a call with the orchestrator headers and the capability name', async () => {
    fake = await startFakeServer(userData, defaultReply);
    const c = await connect();
    await c.listTools();
    const result = await c.callTool({
      name: 'tasks_create',
      arguments: { projectId: 'p1', prompt: 'hi' },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({
      ok: true,
      got: { name: 'tasks.create', input: { projectId: 'p1', prompt: 'hi' } },
    });
    const call = fake.requests.find((r) => r.url === '/v1/call');
    expect(call?.method).toBe('POST');
    expect(call?.headers.authorization).toBe('Bearer orch-token');
    expect(call?.headers['x-dash-caller']).toBe('orchestrator');
    expect(call?.headers.host).toBe(
      `127.0.0.1:${fs.readFileSync(controlPaths(userData).port, 'utf8').trim()}`,
    );
    expect(call?.headers.origin).toBeUndefined();
  });

  it('uses DASH_CALLER and DASH_TOKEN from env for a task', async () => {
    fake = await startFakeServer(userData, defaultReply);
    const c = await connect({ DASH_CALLER: 'task:abc-123', DASH_TOKEN: 'task-token' });
    await c.callTool({ name: 'projects_list', arguments: {} });
    for (const req of fake.requests) {
      expect(req.headers.authorization).toBe('Bearer task-token');
      expect(req.headers['x-dash-caller']).toBe('task:abc-123');
    }
    expect(fake.requests.some((r) => r.url === '/v1/call')).toBe(true);
  });

  it('passes the server error through, with zod details for a 400', async () => {
    fake = await startFakeServer(userData, (req) =>
      req.url === '/v1/call'
        ? {
            status: 400,
            body: {
              error: 'bad input',
              details: [{ path: ['projectId'], message: 'Required' }],
            },
          }
        : defaultReply(req),
    );
    const c = await connect();
    await c.listTools();
    const result = await c.callTool({ name: 'tasks_create', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('bad input');
    expect(textOf(result)).toContain('projectId: Required');
  });

  it('passes a 403 message through', async () => {
    fake = await startFakeServer(userData, () => ({
      status: 403,
      body: { error: 'orchestrator access is off in Dash settings' },
    }));
    const c = await connect();
    expect((await c.listTools()).tools).toEqual([]);
    const result = await c.callTool({ name: 'projects_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('orchestrator access is off in Dash settings');
  });

  it('reports Dash not running when there is no port file', async () => {
    const c = await connect();
    expect((await c.listTools()).tools).toEqual([]);
    const result = await c.callTool({ name: 'projects_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Dash is not running. Open Dash and try again.');
  });

  it('reports Dash not running when the port file is stale', async () => {
    const paths = controlPaths(userData);
    // A port nothing listens on: bind, read it, release it.
    const probe = http.createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    fs.writeFileSync(paths.port, `${port}\n`);
    const c = await connect();
    const result = await c.callTool({ name: 'projects_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Dash is not running. Open Dash and try again.');
  });

  it('sends tools/list_changed once Dash appears', async () => {
    const c = await connect();
    const changed = new Promise<void>((resolve) => {
      c.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve());
    });
    expect((await c.listTools()).tools).toEqual([]);
    fake = await startFakeServer(userData, defaultReply);
    await changed;
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(['projects_list', 'tasks_create']);
  });

  it('answers server/discover with method-not-found and exits on EOF', async () => {
    const child = spawn(process.execPath, [shimPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DASH_USER_DATA_DIR: userData },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    const exited = new Promise<number | null>((resolve) =>
      child.on('exit', (code) => resolve(code)),
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' })}\n`);
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`no reply; got ${out}`)), 5000);
      const check = setInterval(() => {
        if (out.includes('\n')) {
          clearInterval(check);
          clearTimeout(deadline);
          resolve();
        }
      }, 10);
    });
    const reply = JSON.parse(out.split('\n')[0] ?? '') as { id: number; error?: { code: number } };
    expect(reply.id).toBe(1);
    expect(reply.error?.code).toBe(-32601);
    child.stdin.end();
    expect(await exited).toBe(0);
  });
});

describe('dash-mcp launcher', () => {
  it('copies the shim into userData and writes an executable script that runs the copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash launcher's-"));
    try {
      const file = writeLauncher(dir, {
        env: {},
        execPath: '/Apps/Dash.app/Electron',
        bundledShimPath: shimPath,
      });
      const paths = controlPaths(dir);
      expect(file).toBe(paths.launcher);
      expect(fs.statSync(file).mode & 0o777).toBe(0o755);
      // The copy survives the app's own folder going away (an AppImage mount).
      expect(fs.readFileSync(paths.shim, 'utf8')).toBe(fs.readFileSync(shimPath, 'utf8'));
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toBe(
        launcherScript({
          userDataDir: dir,
          execPath: '/Apps/Dash.app/Electron',
          shimPath: paths.shim,
        }),
      );
      expect(content.startsWith('#!/bin/sh\n')).toBe(true);
      expect(content).toContain(
        `DASH_USER_DATA_DIR=${shellQuote(dir)} ELECTRON_RUN_AS_NODE=1 exec '/Apps/Dash.app/Electron' ${shellQuote(paths.shim)} "$@"`,
      );
      expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['dash-mcp', 'dash-mcp.js']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('execs the AppImage file, not the per-launch mount, when APPIMAGE is set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-launcher-'));
    try {
      const file = writeLauncher(dir, {
        env: { APPIMAGE: '/home/me/Apps/Dash.AppImage' },
        bundledShimPath: shimPath,
      });
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain(
        `ELECTRON_RUN_AS_NODE=1 exec '/home/me/Apps/Dash.AppImage' ${shellQuote(controlPaths(dir).shim)} "$@"`,
      );
      expect(content).not.toContain(process.execPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs: the written launcher starts the shim, which exits on EOF', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash launcher's-"));
    try {
      const file = writeLauncher(dir, { env: {}, bundledShimPath: shimPath });
      const child = spawn(file, [], { stdio: ['ignore', 'pipe', 'pipe'] });
      const code = await new Promise<number | null>((resolve) =>
        child.on('exit', (c) => resolve(c)),
      );
      expect(code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
