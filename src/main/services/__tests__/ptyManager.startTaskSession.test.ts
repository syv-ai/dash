import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Task } from '@shared/types';

const sup = vi.hoisted(() => {
  class DispatchError extends Error {
    constructor(
      message: string,
      readonly output: string,
    ) {
      super(message);
    }
  }
  return {
    DispatchError,
    find: vi.fn(async (_jobId: string): Promise<unknown> => null),
    dispatch: vi.fn(async (_opts: Record<string, unknown>) => ({
      jobId: 'job-new',
      sessionId: 'sess-new' as string | null,
    })),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
});
vi.mock('../SupervisorService', () => ({
  DispatchError: sup.DispatchError,
  supervisorService: {
    find: sup.find,
    dispatch: sup.dispatch,
    stop: sup.stop,
    remove: sup.remove,
  },
}));

const tasks = new Map<string, Task>();
const sessions: Array<[string, unknown]> = [];
vi.mock('../DatabaseService', () => ({
  DatabaseService: {
    getTask: (id: string) => tasks.get(id),
    setTaskSession: (id: string, s: unknown) => sessions.push([id, s]),
    getTasksWithSessions: () => [],
  },
}));

const hookWrites: Array<[string, string]> = [];
vi.mock('../ptyHookSettings', () => ({
  writeHookSettings: (cwd: string, id: string) => {
    hookWrites.push([cwd, id]);
    return { ok: true };
  },
  setCommitAttributionValue: () => {},
}));

const supported = vi.hoisted(() => ({ reject: null as Error | null }));
vi.mock('../claudeCli', () => ({
  findClaudePath: async () => '/usr/local/bin/claude',
  findLatestSessionId: () => null,
  requireSupportedClaude: async () => {
    if (supported.reject) throw supported.reject;
  },
}));

const envCalls: Array<[boolean, string | undefined]> = [];
vi.mock('../claudeEnv', () => ({
  buildClaudeEnv: (isDark: boolean, cwd?: string) => {
    envCalls.push([isDark, cwd]);
    return { DASH_TEST: '1' };
  },
  setClaudeEnvVars: () => {},
  setSyncShellEnv: () => {},
  setUltracode: () => {},
}));

const mcp = vi.hoisted(() => ({
  forDispatch: vi.fn((task: { id: string; dashAccess: boolean }) =>
    task.dashAccess
      ? { path: `/u/control/mcp-config/${task.id}.json`, allowTools: ['mcp__dash__tasks_get'] }
      : undefined,
  ),
}));
vi.mock('../../control/mcpConfig', () => ({ mcpConfigForDispatch: mcp.forDispatch }));

const trust = vi.hoisted(() => ({ trusted: false }));
vi.mock('../../utils/claudePaths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/claudePaths')>()),
  isWorkspaceTrusted: async () => trust.trusted,
}));

const ptySpawn = vi.hoisted(() => vi.fn());
vi.mock('node-pty', () => ({ spawn: ptySpawn }));

import {
  startTaskSession,
  getUntrustedRoot,
  setInitialPrompt,
  recheckWorkspaceTrust,
  setAppIsDark,
  __testReset,
} from '../ptyManager';
import { activityMonitor } from '../ActivityMonitor';

function seed(over: Partial<Task> = {}): Task {
  const t = {
    id: 't1',
    projectId: 'p1',
    name: 'Fix login',
    path: '/wt/fix-login',
    permissionMode: 'acceptEdits',
    model: 'sonnet',
    previousPath: null,
    jobId: null,
    sessionId: 'sess-old',
    ...over,
  } as Task;
  tasks.set(t.id, t);
  return t;
}

beforeEach(() => {
  __testReset();
  tasks.clear();
  sessions.length = 0;
  hookWrites.length = 0;
  envCalls.length = 0;
  supported.reject = null;
  trust.trusted = false;
  vi.clearAllMocks();
  activityMonitor.unregister('t1');
});

describe('startTaskSession', () => {
  it('dispatches with the task settings from the DB and spawns no PTY', async () => {
    seed();
    const result = await startTaskSession('t1');
    expect(result).toEqual({ jobId: 'job-new' });
    expect(sup.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/wt/fix-login',
        name: 'Fix login',
        permissionMode: 'acceptEdits',
        model: 'sonnet',
        resumeSessionId: 'sess-old',
        env: { DASH_TEST: '1' },
      }),
    );
    expect(hookWrites).toEqual([['/wt/fix-login', 't1']]);
    expect(sessions).toEqual([['t1', { jobId: 'job-new', sessionId: 'sess-new' }]]);
    expect(activityMonitor.has('t1')).toBe(true);
    expect(ptySpawn).not.toHaveBeenCalled();
  });

  it('reuses a live job without dispatching', async () => {
    seed({ jobId: 'job-live' });
    sup.find.mockResolvedValueOnce({ cwd: '/wt/fix-login', sessionId: 'sess-old' });
    expect(await startTaskSession('t1')).toEqual({ jobId: 'job-live' });
    expect(sup.dispatch).not.toHaveBeenCalled();
  });

  it('returns needsTrust for an untrusted folder and keeps the first prompt', async () => {
    seed();
    setInitialPrompt('t1', 'do the thing');
    sup.dispatch.mockRejectedValueOnce(
      new sup.DispatchError(
        'refused',
        'Workspace not trusted. Run `claude` in /wt/fix-login once to trust it.',
      ),
    );
    expect(await startTaskSession('t1')).toEqual({ needsTrust: '/wt/fix-login' });
    expect(getUntrustedRoot('t1')).toBe('/wt/fix-login');
    // No session started: no activity entry left behind.
    expect(activityMonitor.has('t1')).toBe(false);

    // The next dispatch (after the trust prompt) still carries the prompt.
    await startTaskSession('t1');
    expect(sup.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'do the thing' }),
    );
  });

  it('clears the needs-trust mark once a dispatch succeeds', async () => {
    seed();
    sup.dispatch.mockRejectedValueOnce(
      new sup.DispatchError(
        'refused',
        'Workspace not trusted. Run `claude` in /wt/fix-login once to trust it.',
      ),
    );
    await startTaskSession('t1');
    expect(getUntrustedRoot('t1')).toBe('/wt/fix-login');
    // Trusted elsewhere (e.g. `claude` run in the folder), then started again.
    await startTaskSession('t1');
    expect(getUntrustedRoot('t1')).toBeUndefined();
  });

  it('marks the task busy after a dispatch that carries the first prompt', async () => {
    seed();
    setInitialPrompt('t1', 'do the thing');
    await startTaskSession('t1');
    expect(activityMonitor.getAll()['t1']?.state).toBe('busy');
  });

  it('leaves a dispatch without a prompt idle', async () => {
    seed();
    await startTaskSession('t1');
    expect(activityMonitor.getAll()['t1']?.state).toBe('idle');
  });

  it('passes an mcp-config for a task with Dash access, read from the row at dispatch', async () => {
    seed({ dashAccess: false });
    await startTaskSession('t1');
    expect(sup.dispatch.mock.calls[0]![0].mcpConfigPath).toBeUndefined();
    expect(mcp.forDispatch).toHaveBeenLastCalledWith({ id: 't1', dashAccess: false });

    // Toggled on in the DB, then restarted (the job is gone): the next dispatch sees it.
    tasks.set('t1', { ...tasks.get('t1')!, dashAccess: true, jobId: null });
    await startTaskSession('t1');
    expect(sup.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mcpConfigPath: '/u/control/mcp-config/t1.json',
        allowTools: ['mcp__dash__tasks_get'],
      }),
    );
  });

  it('does not touch the mcp-config when reusing a live job', async () => {
    seed({ jobId: 'job-live', dashAccess: true });
    sup.find.mockResolvedValueOnce({ cwd: '/wt/fix-login', sessionId: 'sess-old' });
    await startTaskSession('t1');
    expect(mcp.forDispatch).not.toHaveBeenCalled();
  });

  it('uses the last isDark a pane passed when the caller gives none', async () => {
    seed();
    await startTaskSession('t1');
    expect(envCalls.at(-1)).toEqual([true, '/wt/fix-login']);
    await startTaskSession('t1', { isDark: false });
    await startTaskSession('t1');
    expect(envCalls.slice(-2)).toEqual([
      [false, '/wt/fix-login'],
      [false, '/wt/fix-login'],
    ]);
  });

  it("uses the app's theme for a start with no pane; a pane's own isDark wins", async () => {
    seed();
    setAppIsDark(false);
    await startTaskSession('t1');
    expect(envCalls.at(-1)).toEqual([false, '/wt/fix-login']);
    await startTaskSession('t1', { isDark: true });
    expect(envCalls.at(-1)).toEqual([true, '/wt/fix-login']);
    setAppIsDark(false);
    await startTaskSession('t1');
    expect(envCalls.at(-1)).toEqual([false, '/wt/fix-login']);
  });

  it('runs one dispatch for two concurrent starts and gives both its job', async () => {
    seed();
    const [a, b] = await Promise.all([startTaskSession('t1'), startTaskSession('t1')]);
    expect(sup.dispatch).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ jobId: 'job-new' });
    expect(b).toEqual({ jobId: 'job-new' });
  });

  it('starts again after a concurrent pair settles', async () => {
    seed();
    await Promise.all([startTaskSession('t1'), startTaskSession('t1')]);
    await startTaskSession('t1');
    expect(sup.dispatch).toHaveBeenCalledTimes(2); // the mock DB keeps jobId null
  });

  it('refuses an unsupported CLI before touching the task', async () => {
    seed();
    supported.reject = new Error('Claude Code too old');
    await expect(startTaskSession('t1')).rejects.toThrow('Claude Code too old');
    expect(sup.dispatch).not.toHaveBeenCalled();
    expect(hookWrites).toEqual([]);
  });

  it('throws for an unknown task', async () => {
    await expect(startTaskSession('nope')).rejects.toThrow(/not found/i);
  });
});

describe('recheckWorkspaceTrust', () => {
  async function refuseAsUntrusted(): Promise<void> {
    seed();
    sup.dispatch.mockRejectedValueOnce(
      new sup.DispatchError(
        'refused',
        'Workspace not trusted. Run `claude` in /wt/fix-login once to trust it.',
      ),
    );
    await startTaskSession('t1');
  }

  it('is true for a task never marked untrusted', async () => {
    expect(await recheckWorkspaceTrust('t1')).toBe(true);
  });

  it('stays false while the root is still untrusted', async () => {
    await refuseAsUntrusted();
    expect(await recheckWorkspaceTrust('t1')).toBe(false);
    expect(getUntrustedRoot('t1')).toBe('/wt/fix-login');
  });

  it('clears the mark once the root was trusted outside Dash', async () => {
    await refuseAsUntrusted();
    trust.trusted = true;
    expect(await recheckWorkspaceTrust('t1')).toBe(true);
    expect(getUntrustedRoot('t1')).toBeUndefined();
  });
});
