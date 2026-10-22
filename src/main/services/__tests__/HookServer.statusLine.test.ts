import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Real HTTP path through HookServer: the request a session's statusLine makes.
// Only electron and the DB are faked. (Harness adapted from #191.)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dash-hookserver-test' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported = () => false;
  },
}));

const TASKS = [
  { id: 'root', path: '/p' },
  { id: 'wt', path: '/p/.claude/worktrees/wt' },
];

// `where(eq(column, value))` → the task whose path or id is `value`.
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (_column: unknown, value: unknown) => ({ value }),
}));
vi.mock('../../db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: ({ value }: { value: string }) => ({
          get: () => TASKS.find((t) => t.path === value || t.id === value),
        }),
      }),
    }),
  }),
}));

import { hookServer } from '../HookServer';
import { contextUsageService } from '../ContextUsageService';

let port = 0;
const postContext = (ptyId: string, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/hook/context?ptyId=${ptyId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const report = (dir: string) => ({
  workspace: { project_dir: dir },
  cwd: dir,
  context_window: { context_window_size: 1000, used_percentage: 25 },
});

describe('HookServer statusLine routing', () => {
  const update = vi.spyOn(contextUsageService, 'updateFromStatusLine');
  let live = (id: string) => TASKS.some((t) => t.id === id);

  beforeAll(async () => {
    hookServer.setPtyValidator((id) => live(id));
    port = await hookServer.start();
  });
  afterAll(() => hookServer.stop());
  beforeEach(() => {
    update.mockClear();
    live = (id) => TASKS.some((t) => t.id === id);
  });

  it("credits the root's status line, run in a worktree session, to the worktree task", async () => {
    const res = await postContext('root', report('/p/.claude/worktrees/wt'));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe('wt');
  });

  it("keeps the root session's own report on the root task", async () => {
    await postContext('root', report('/p'));
    expect(update.mock.calls[0]![0]).toBe('root');
  });

  it('uses the URL id for a folder no task has (e.g. a non-task worktree)', async () => {
    await postContext('root', report('/p/.claude/worktrees/subagent'));
    expect(update.mock.calls[0]![0]).toBe('root');
  });

  it('drops a report for a worktree task without a live pty, rather than credit the root', async () => {
    live = (id) => id === 'root';
    const res = await postContext('root', report('/p/.claude/worktrees/wt'));
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
});
