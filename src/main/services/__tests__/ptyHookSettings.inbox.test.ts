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

import { writeHookSettings, INBOX_HEADER_ARGS } from '../ptyHookSettings';

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
    expect(inbox!.command).toContain(INBOX_HEADER_ARGS);
    expect(inbox!.async).toBe(true);
    // The clear/compact entries post to session-start, which sets idle; no inbox there.
    expect(hooks.SessionStart![0]!.hooks[0]!.command).not.toContain('X-Dash-Messaging');
  });

  it('UserPromptSubmit sends the inbox headers with the busy report', () => {
    const [busy] = hooks.UserPromptSubmit![0]!.hooks;
    expect(busy!.command).toContain('/hook/busy?ptyId=task-1');
    expect(busy!.command).toContain(
      `-H "X-Dash-Messaging-Socket: $CLAUDE_CODE_MESSAGING_SOCKET" -H "X-Dash-Messaging-Token: $CLAUDE_CODE_MESSAGING_TOKEN"`,
    );
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

  it('runs under sh with both variables unset, sending empty headers', async () => {
    const { execFileSync } = await import('child_process');
    const line = `printf '%s\\n'${INBOX_HEADER_ARGS.replace(/ -H /g, ' ')}`;
    const out = execFileSync('sh', ['-c', line], {
      env: { PATH: process.env.PATH, CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/a b.sock' },
    }).toString();
    expect(out).toBe('X-Dash-Messaging-Socket: /tmp/a b.sock\nX-Dash-Messaging-Token: \n');
  });
});
