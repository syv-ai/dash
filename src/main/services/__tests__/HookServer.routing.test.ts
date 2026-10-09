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

const ROOT = '/p/music removal';
const TASKS = [
  { id: 'root', path: ROOT },
  { id: 'ball', path: `${ROOT}/.claude/worktrees/ball-kinetics-071` },
  { id: 'court', path: `${ROOT}/.claude/worktrees/court-segmentation-ed2` },
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

const statusLine = (projectDir: string) => ({
  workspace: { project_dir: projectDir, current_dir: projectDir },
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

  it("credits a worktree session's status line to its own task, not the root id in the URL", async () => {
    // Root's settings.local.json leaks into the worktree session: ptyId=root.
    const res = await post('context', 'root', statusLine(TASKS[1]!.path));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe('ball');
  });

  it('still credits the root task for a session running in the root', async () => {
    await post('context', 'root', statusLine(ROOT));
    expect(update.mock.calls[0]![0]).toBe('root');
  });

  it('routes other hooks (busy) by cwd too', async () => {
    await post('busy', 'root', { cwd: TASKS[2]!.path });
    expect(busy).toHaveBeenCalledWith('court');
  });

  it('ignores events from a subagent worktree nested under the root task', async () => {
    const res = await post('context', 'root', statusLine(`${ROOT}/.claude/worktrees/agent-a0`));
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });

  it('falls back to the URL id when the payload has no directory', async () => {
    await post('busy', 'court', {});
    expect(busy).toHaveBeenCalledWith('court');
  });

  it('404s when the resolved task has no live pty', async () => {
    hookServer.setPtyValidator((id) => id !== 'ball');
    const res = await post('context', 'root', statusLine(TASKS[1]!.path));
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    hookServer.setPtyValidator((id) => TASKS.some((t) => t.id === id));
  });
});
