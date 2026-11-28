import { describe, it, expect, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dash-hooksettings-test' },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../HookServer', () => ({
  hookServer: { port: 1234 },
  getHookPortFilePath: () => '/tmp/dash-hook-port',
}));

import { writeHookSettings } from '../ptyHookSettings';
import { WAIT_NOTIFICATIONS } from '../hookPayload';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-hooks-waits-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Hook = { type: string; command: string; async?: boolean };
type Entry = { matcher: string; hooks: Hook[] };

function written(): Record<string, Entry[]> {
  expect(writeHookSettings(dir, 'task-1')).toEqual({ ok: true });
  return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'))
    .hooks;
}

/** Run a hook's command under sh against a local server: what it posted, printed, exited with. */
async function run(command: string, stdin: string) {
  const http = await import('http');
  const { execFile } = await import('child_process');
  const got: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      got.push(req.url!);
      // Whatever Dash answers must not become the hook's output.
      res.end('{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const portFile = path.join(dir, 'port');
  fs.writeFileSync(portFile, String((server.address() as { port: number }).port));
  try {
    return await new Promise<{ got: string[]; out: string; code: number }>((resolve) => {
      const child = execFile(
        'sh',
        ['-c', command.replace('/tmp/dash-hook-port', portFile)],
        { env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: dir } },
        (err, stdout) =>
          resolve({ got, out: stdout, code: err ? ((err as { code?: number }).code ?? 1) : 0 }),
      );
      child.stdin!.end(stdin);
    });
  } finally {
    server.close();
  }
}

describe('hooks for a wait on the user', () => {
  const hooks = written();

  it('registers every notification type Dash acts on, all to /hook/notification', () => {
    const matchers = hooks.Notification!.map((e) => e.matcher);
    expect(new Set(matchers)).toEqual(new Set(Object.keys(WAIT_NOTIFICATIONS)));
    for (const e of hooks.Notification!) {
      expect(e.hooks[0]!.command).toContain('/hook/notification?ptyId=${DASH_TASK_ID:-task-1}');
    }
  });

  it('observes MCP elicitations from the moment they open, asynchronously', () => {
    for (const [event, endpoint] of [
      ['Elicitation', 'elicitation'],
      ['ElicitationResult', 'elicitation-result'],
    ] as const) {
      expect(hooks[event], event).toHaveLength(1);
      const [hook] = hooks[event]![0]!.hooks;
      expect(hook!.command).toContain(`/hook/${endpoint}?ptyId=\${DASH_TASK_ID:-task-1}`);
      // async: Claude Code ignores any answer, so the hook can never accept,
      // decline or rewrite the user's response.
      expect(hook!.async).toBe(true);
    }
  });

  it('observes permission requests the moment they open, asynchronously', () => {
    expect(hooks.PermissionRequest).toHaveLength(1);
    const [hook] = hooks.PermissionRequest![0]!.hooks;
    expect(hook!.command).toContain('/hook/permission-request?ptyId=${DASH_TASK_ID:-task-1}');
    // async: Claude Code reads no decision from it, so the user's prompt
    // always appears and decides.
    expect(hook!.async).toBe(true);
  });

  it('a permission request hook prints nothing and exits 0, whatever Dash answers', async () => {
    const { command } = hooks.PermissionRequest![0]!.hooks[0]!;
    const { got, out, code } = await run(command, '{"tool_name":"Bash","tool_input":{}}');
    expect(got).toEqual(['/hook/permission-request?ptyId=task-1']);
    expect(out).toBe('');
    expect(code).toBe(0);
  });

  it('an elicitation hook prints nothing and exits 0, whatever Dash answers', async () => {
    const { command } = hooks.Elicitation![0]!.hooks[0]!;
    const { got, out, code } = await run(command, '{"mcp_server_name":"s","message":"m"}');
    expect(got).toEqual(['/hook/elicitation?ptyId=task-1']);
    expect(out).toBe('');
    expect(code).toBe(0);
  });
});
