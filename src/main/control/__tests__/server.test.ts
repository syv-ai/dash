import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { ControlServer } from '../server';
import { createRegistry, defineCapability } from '../registry';
import { initTokens, tokenFor } from '../tokens';
import { controlPaths } from '../paths';
import { fakeLookups, makeProject, makeTask } from './fixtures';

const taskId = '0f8fad5b-d9cb-469f-a165-70867728950e';
const orch = { kind: 'orchestrator' } as const;
const asTask = { kind: 'task', taskId } as const;

let userData: string;
let server: ControlServer;
let port: number;
let orchestratorAllowed: boolean;

beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-control-'));
  initTokens(userData);
  const registry = createRegistry(
    fakeLookups(
      [makeProject({ id: 'pA' })],
      [makeTask({ id: taskId, projectId: 'pA', dashAccess: true })],
    ),
  );
  registry.register(
    defineCapability({
      name: 'echo',
      summary: 'Echo the input',
      input: z.object({ text: z.string() }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      handler: async (ctx, input) => ({ text: input.text, caller: ctx.caller.kind }),
    }),
  );
  orchestratorAllowed = true;
  server = new ControlServer({
    userDataDir: userData,
    registry,
    isOrchestratorAllowed: () => orchestratorAllowed,
    version: '0.0.0-test',
  });
  port = await server.start();
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(userData, { recursive: true, force: true });
});

function authHeaders(caller: typeof orch | typeof asTask = orch): Record<string, string> {
  return {
    Authorization: `Bearer ${tokenFor(caller)}`,
    'X-Dash-Caller': caller.kind === 'task' ? `task:${caller.taskId}` : 'orchestrator',
  };
}

function call(body: unknown, headers: Record<string, string> = authHeaders()) {
  return fetch(`http://127.0.0.1:${port}/v1/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** fetch() silently drops a custom Host header, so Host tests go through node:http. */
function rawCall(host: string): Promise<number> {
  const body = JSON.stringify({ name: 'echo', input: { text: 'hi' } });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/call',
        headers: { ...authHeaders(), Host: host, 'Content-Type': 'application/json' },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('ControlServer', () => {
  it('writes the port file after listen and removes it on stop', async () => {
    const file = controlPaths(userData).port;
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(String(port));
    await server.stop();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('answers a good token with 200 and the result', async () => {
    const res = await call({ name: 'echo', input: { text: 'hi' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { text: 'hi', caller: 'orchestrator' } });

    const asTaskRes = await call({ name: 'echo', input: { text: 'x' } }, authHeaders(asTask));
    expect(asTaskRes.status).toBe(200);
  });

  it('lists capabilities', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/capabilities`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capabilities: Array<{ name: string }> };
    expect(body.capabilities.map((c) => c.name)).toEqual(['echo']);
  });

  it('accepts 127.0.0.1:<port> and localhost:<port> as Host', async () => {
    expect(await rawCall(`127.0.0.1:${port}`)).toBe(200);
    expect(await rawCall(`localhost:${port}`)).toBe(200);
  });

  it('rejects a foreign Host with 403', async () => {
    expect(await rawCall(`evil.example:${port}`)).toBe(403);
    expect(await rawCall(`127.0.0.1:${port + 1}`)).toBe(403);
  });

  it('rejects any Origin header with 403', async () => {
    const res = await call(
      { name: 'echo', input: { text: 'hi' } },
      {
        ...authHeaders(),
        Origin: `http://127.0.0.1:${port}`,
      },
    );
    expect(res.status).toBe(403);
  });

  it('rejects a missing or wrong token with 401', async () => {
    expect((await call({ name: 'echo', input: { text: 'hi' } }, {})).status).toBe(401);
    const wrong = { ...authHeaders(asTask), 'X-Dash-Caller': 'orchestrator' };
    expect((await call({ name: 'echo', input: { text: 'hi' } }, wrong)).status).toBe(401);
    const badCaller = { ...authHeaders(), 'X-Dash-Caller': 'root' };
    expect((await call({ name: 'echo', input: { text: 'hi' } }, badCaller)).status).toBe(401);
  });

  it('refuses the orchestrator while orchestrator access is off', async () => {
    orchestratorAllowed = false;
    const res = await call({ name: 'echo', input: { text: 'hi' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'orchestrator access is off in Dash settings' });
    // Task callers do not need the global switch.
    expect((await call({ name: 'echo', input: { text: 'x' } }, authHeaders(asTask))).status).toBe(
      200,
    );
  });

  it('maps registry errors and bad bodies to statuses', async () => {
    expect((await call({ name: 'echo', input: { text: 1 } })).status).toBe(400);
    expect((await call({ name: 'missing', input: {} })).status).toBe(404);
    expect((await call('not json')).status).toBe(400);
    expect((await call({ input: {} })).status).toBe(400);
  });

  it('rejects a body over 64 KB with 413', async () => {
    const res = await call({ name: 'echo', input: { text: 'x'.repeat(70_000) } });
    expect(res.status).toBe(413);
  });

  it('404s unknown routes and 405s wrong methods', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/nope`, { headers: authHeaders() });
    expect(res.status).toBe(404);
    const wrongMethod = await fetch(`http://127.0.0.1:${port}/v1/call`, { headers: authHeaders() });
    expect(wrongMethod.status).toBe(405);
  });
});
