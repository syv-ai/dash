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
vi.mock('../RtkService', () => ({ RtkService: { isEnabled: () => false } }));
vi.mock('../DatabaseService', () => ({ DatabaseService: { getTask: () => undefined } }));

import { writeHookSettings, INBOX_HEADERS_HEREDOC } from '../ptyHookSettings';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-hooks-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Hook = { type: string; command: string; async?: boolean };
type Entry = { matcher: string; hooks: Hook[] };

function written(): Record<string, Entry[]> {
  expect(writeHookSettings(dir, 'task-1')).toEqual({ ok: true });
  return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'))
    .hooks;
}

describe('the inbox hooks', () => {
  const hooks = written();

  it('SessionStart reports the inbox for every source, beside the clear/compact idle hooks', () => {
    expect(hooks.SessionStart!.map((e) => e.matcher)).toEqual(['clear', 'compact', '']);
    const [inbox] = hooks.SessionStart![2]!.hooks;
    expect(inbox!.command).toContain('/hook/inbox?ptyId=task-1');
    expect(inbox!.command).toContain(INBOX_HEADERS_HEREDOC);
    expect(inbox!.async).toBe(true);
    // The clear/compact entries post to session-start, which sets idle; no inbox there.
    expect(hooks.SessionStart![0]!.hooks[0]!.command).not.toContain('X-Dash-Messaging');
  });

  it('UserPromptSubmit sends the inbox headers with the busy report', () => {
    const [busy] = hooks.UserPromptSubmit![0]!.hooks;
    expect(busy!.command).toContain('/hook/busy?ptyId=task-1');
    // The headers come on fd 3 from a heredoc: never in curl's argv.
    const [curlLine] = busy!.command.split(' 3<<');
    expect(curlLine).toContain('-H @/dev/fd/3');
    expect(curlLine).not.toContain('CLAUDE_CODE_MESSAGING');
    expect(busy!.command).toContain(INBOX_HEADERS_HEREDOC);
  });

  it('writes only hook events Claude Code knows, and no new hook fields', () => {
    const known = new Set([
      'Stop',
      'UserPromptSubmit',
      'Notification',
      'PreToolUse',
      'PostToolUse',
      'PreCompact',
      'PostCompact',
      'StopFailure',
      'SessionStart',
      'SessionEnd',
    ]);
    for (const [event, entries] of Object.entries(hooks)) {
      expect(known.has(event), event).toBe(true);
      for (const e of entries) {
        for (const h of e.hooks) {
          for (const key of Object.keys(h))
            expect(['type', 'command', 'async', '__dash']).toContain(key);
        }
      }
    }
  });

  /** Run a hook's command under sh against a local server; what it got and printed. */
  async function run(command: string, env: Record<string, string>) {
    const http = await import('http');
    const { execFile } = await import('child_process');
    const got: Array<{ url: string; headers: Record<string, unknown>; body: string }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        got.push({ url: req.url!, headers: req.headers, body });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const portFile = path.join(dir, 'port');
    fs.writeFileSync(portFile, String((server.address() as { port: number }).port));
    const cmd = command.replace('/tmp/dash-hook-port', portFile);
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          'sh',
          ['-c', cmd],
          { env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: dir, ...env } },
          (err, stdout) => (err ? reject(err) : resolve(stdout)),
        );
        child.stdin!.end('{"transcript_path":"/x.jsonl"}');
      });
      return { got, out };
    } finally {
      server.close();
    }
  }

  it('sends both headers under sh, printing nothing (SessionStart stdout is context)', async () => {
    const { command } = hooks.SessionStart![2]!.hooks[0]!;
    const { got, out } = await run(command, {
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/a b.sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
    });
    expect(out).toBe('');
    expect(got).toHaveLength(1);
    expect(got[0]!.url).toBe('/hook/inbox?ptyId=task-1');
    expect(got[0]!.body).toBe('{"transcript_path":"/x.jsonl"}');
    expect(got[0]!.headers['x-dash-messaging-socket']).toBe('/tmp/a b.sock');
    expect(got[0]!.headers['x-dash-messaging-token']).toBe('tok');
  });

  it('still posts, with no inbox headers worth keeping, when both variables are unset', async () => {
    const { command } = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const { got, out } = await run(command, {});
    expect(out).toBe('');
    expect(got).toHaveLength(1);
    expect(got[0]!.headers['x-dash-messaging-token'] ?? '').toBe('');
  });
});
