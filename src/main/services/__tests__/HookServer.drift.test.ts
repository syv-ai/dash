import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Real HTTP path through HookServer: every body is checked against the
// contract after the response, and drift reaches the reporter.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dash-hookserver-drift-test' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported = () => false;
  },
}));
vi.mock('../../db/client', () => ({ getDb: () => ({}) }));

import { hookServer } from '../HookServer';
import { activityMonitor } from '../ActivityMonitor';
import { installDriftReporter } from '../../claudeContract/driftReporter';
import { noteTaskClaudeVersion } from '../../claudeContract/claudeVersions';
import type { DriftReport } from '../../claudeContract/types';

let port = 0;
const sent: DriftReport[] = [];
const post = (endpoint: string, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/hook/${endpoint}?ptyId=t1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
/** The check runs on the next turn of the event loop. */
const settle = () => new Promise((r) => setImmediate(r));

const stop = {
  session_id: 's',
  transcript_path: '/t.jsonl',
  cwd: '/c',
  hook_event_name: 'Stop',
  stop_hook_active: false,
};

describe('HookServer contract drift', () => {
  beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    hookServer.setPtyValidator(() => true);
    port = await hookServer.start();
    noteTaskClaudeVersion('t1', '2.1.332');
  });
  afterAll(() => hookServer.stop());
  beforeEach(() => {
    sent.length = 0;
    installDriftReporter({ dir: null, send: (r) => (sent.push(r), true) });
  });

  it('reports a new field under the task’s Claude Code version, and still handles the hook', async () => {
    const endTurn = vi.spyOn(activityMonitor, 'endTurn');
    const res = await post('stop', { ...stop, brand_new: 'secret' });
    await settle();
    expect(res.status).toBe(200);
    expect(endTurn).toHaveBeenCalled();
    expect(sent).toEqual([
      {
        source: 'hook:Stop',
        kind: 'unexpected-field',
        path: 'brand_new',
        claudeVersion: '2.1.332',
      },
    ]);
  });

  it('reports nothing for a payload that matches', async () => {
    await post('stop', stop);
    await settle();
    expect(sent).toEqual([]);
  });
});
