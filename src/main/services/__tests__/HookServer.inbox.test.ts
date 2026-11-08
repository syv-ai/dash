import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as path from 'path';

// Real HTTP path through HookServer: the inbox report a session's hooks make.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dash-hookserver-inbox-test' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported = () => false;
  },
}));
vi.mock('../../db/client', () => ({ getDb: () => ({}) }));

import { hookServer } from '../HookServer';
import { activityMonitor } from '../ActivityMonitor';
import { getTaskInbox, resetTaskInboxes } from '../taskInbox';
import { claudeConfigDir } from '../../utils/claudePaths';

let port = 0;
const transcript = path.join(claudeConfigDir(), 'projects', '-p', 's.jsonl');
const post = (endpoint: string, headers: Record<string, string>, body: unknown = {}) =>
  fetch(`http://127.0.0.1:${port}/hook/${endpoint}?ptyId=t1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const inboxHeaders = {
  'X-Dash-Messaging-Socket': '/tmp/cc-socks/9.sock',
  'X-Dash-Messaging-Token': 'secret',
};

describe('HookServer inbox reports', () => {
  beforeAll(async () => {
    hookServer.setPtyValidator(() => true);
    port = await hookServer.start();
  });
  afterAll(() => hookServer.stop());
  beforeEach(() => resetTaskInboxes());

  it('SessionStart (/hook/inbox) stores the inbox and leaves activity alone', async () => {
    const idle = vi.spyOn(activityMonitor, 'setIdle');
    const busy = vi.spyOn(activityMonitor, 'setBusy');
    const res = await post('inbox', inboxHeaders, { transcript_path: transcript });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(getTaskInbox('t1')).toEqual({
      socket: '/tmp/cc-socks/9.sock',
      token: 'secret',
      transcriptPath: transcript,
    });
    expect(idle).not.toHaveBeenCalled();
    expect(busy).not.toHaveBeenCalled();
  });

  it('UserPromptSubmit (/hook/busy) stores it too', async () => {
    await post('busy', inboxHeaders);
    expect(getTaskInbox('t1')?.socket).toBe('/tmp/cc-socks/9.sock');
  });

  it('ignores empty headers (variables unset) and a transcript outside Claude Code projects', async () => {
    await post('inbox', { 'X-Dash-Messaging-Socket': '', 'X-Dash-Messaging-Token': '' });
    expect(getTaskInbox('t1')).toBeUndefined();
    await post('inbox', inboxHeaders, { transcript_path: '/etc/passwd.jsonl' });
    expect(getTaskInbox('t1')?.transcriptPath).toBeNull();
  });
});
