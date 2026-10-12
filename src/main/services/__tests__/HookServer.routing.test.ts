import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Real HTTP path through HookServer: the same request a worktree session's
// settings.local.json makes. Only electron and the DB are faked.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dash-hookserver-test' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported = () => false;
  },
}));

const TASKS = [
  { id: 'root', sessionId: 'sess-root' },
  { id: 'ball', sessionId: 'sess-ball' },
  { id: 'court', sessionId: 'sess-court' },
];

vi.mock('../../db/client', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ all: () => TASKS, get: () => undefined }) }) }),
  }),
}));

import { hookServer } from '../HookServer';
import { contextUsageService } from '../ContextUsageService';
import { activityMonitor } from '../ActivityMonitor';

let port = 0;
const post = (endpoint: string, ptyId: string, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/hook/${endpoint}?ptyId=${ptyId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const statusLine = (sessionId: string) => ({
  session_id: sessionId,
  context_window: { context_window_size: 1000, used_percentage: 25 },
  rate_limits: { five_hour: { used_percentage: 6, resets_at: 1 } },
});

describe('HookServer task resolution', () => {
  const update = vi.spyOn(contextUsageService, 'updateFromStatusLine');
  const busy = vi.spyOn(activityMonitor, 'setBusy');

  beforeAll(async () => {
    hookServer.setPtyValidator((id) => TASKS.some((t) => t.id === id));
    port = await hookServer.start();
  });
  afterAll(() => hookServer.stop());
  beforeEach(() => {
    update.mockClear();
    busy.mockClear();
  });

  it("handles a worktree session's own copy under its own id", async () => {
    await post('context', 'ball', statusLine('sess-ball'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe('ball');
  });

  it('acks but skips the leaked root-settings copy of a worktree session', async () => {
    const res = await post('context', 'root', statusLine('sess-ball'));
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });

  it('delivers a worktree event once when both settings files fire', async () => {
    const body = { session_id: 'sess-court' };
    await Promise.all([post('busy', 'root', body), post('busy', 'court', body)]);
    expect(busy).toHaveBeenCalledTimes(1);
    expect(busy).toHaveBeenCalledWith('court');
  });

  it('keeps a root session that cd-ed into a worktree on the root task', async () => {
    await post('busy', 'root', { session_id: 'sess-root', cwd: '/p/.claude/worktrees/ball' });
    expect(busy).toHaveBeenCalledWith('root');
  });

  it('still handles events from a non-task worktree session under the URL id', async () => {
    await post('busy', 'root', { session_id: 'sess-subagent' });
    expect(busy).toHaveBeenCalledWith('root');
  });

  it('falls back to the URL id when the payload has no session id', async () => {
    await post('busy', 'court', {});
    expect(busy).toHaveBeenCalledWith('court');
  });

  it('404s when the resolved task has no live pty', async () => {
    hookServer.setPtyValidator((id) => id !== 'ball');
    const res = await post('context', 'ball', statusLine('sess-ball'));
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    hookServer.setPtyValidator((id) => TASKS.some((t) => t.id === id));
  });
});
