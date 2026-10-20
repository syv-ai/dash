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
    respawn: vi.fn(async (_jobId: string) => {}),
  };
});
vi.mock('../SupervisorService', () => ({
  DispatchError: sup.DispatchError,
  supervisorService: {
    find: sup.find,
    dispatch: sup.dispatch,
    stop: sup.stop,
    remove: sup.remove,
    respawn: sup.respawn,
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
  buildSessionEnv: (cwd: string) => ({ WEB_PORT: cwd === '/wt/fix-login' ? '3001' : '0' }),
  isUltracode: () => false,
  setClaudeEnvVars: () => {},
  setSyncShellEnv: () => {},
  setUltracode: () => {},
}));

/** Writes of the task's `--settings` file, in order with the supervisor calls. */
const settingsWrites = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock('../taskSettings', () => ({
  writeTaskSettings: (id: string, settings: unknown) => {
    settingsWrites.push([id, settings]);
    return `/u/task-settings/${id}.json`;
  },
}));

const hook = { type: 'command' as const, command: 'export PATH' };
vi.mock('../../control/taskAccess', () => ({
  dashSessionAccess: (task: { id: string; dashAccess: boolean }) =>
    task.dashAccess
      ? {
          env: { DASH_CALLER: `task:${task.id}`, DASH_TOKEN: 'tok' },
          allow: ['Bash(dashctl tasks get:*)'],
          sessionStart: [hook],
          dashctl: '/u/control/bin/dashctl',
        }
      : null,
}));

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
  settingsWrites.length = 0;
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
    sup.find.mockResolvedValueOnce({ cwd: '/wt/fix-login', sessionId: 'sess-old', pid: 7 });
    expect(await startTaskSession('t1')).toEqual({ jobId: 'job-live' });
    expect(sup.dispatch).not.toHaveBeenCalled();
    expect(sup.respawn).not.toHaveBeenCalled();
  });

  it('wakes a stopped job in place (respawn keeps its options), and leaves a running one', async () => {
    seed({ jobId: 'job-live' });
    sup.find.mockResolvedValueOnce({
      cwd: '/wt/fix-login',
      sessionId: 'sess-old',
      state: 'stopped',
    });
    expect(await startTaskSession('t1')).toEqual({ jobId: 'job-live' });
    expect(sup.respawn).toHaveBeenCalledWith('job-live');
    expect(sup.dispatch).not.toHaveBeenCalled();
    sup.respawn.mockClear();
    sup.find.mockResolvedValueOnce({ cwd: '/wt/fix-login', pid: 7, state: 'working' });
    await startTaskSession('t1');
    expect(sup.respawn).not.toHaveBeenCalled();
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

  it("dispatches with the task's settings file: its env, and dashctl with Dash access", async () => {
    seed({ dashAccess: true });
    await startTaskSession('t1');
    expect(settingsWrites).toEqual([
      [
        't1',
        {
          permissions: { allow: ['Bash(dashctl tasks get:*)'] },
          env: { WEB_PORT: '3001', DASH_CALLER: 'task:t1', DASH_TOKEN: 'tok' },
          hooks: { SessionStart: [{ matcher: '', hooks: [hook] }] },
        },
      ],
    ]);
    expect(sup.dispatch.mock.calls[0]![0].settingsPath).toBe('/u/task-settings/t1.json');
  });

  it('reads Dash access from the row at each start, so a restart after a toggle sees it', async () => {
    seed({ dashAccess: false });
    await startTaskSession('t1');
    expect(settingsWrites[0]![1]).toEqual({ env: { WEB_PORT: '3001' } });
    tasks.set('t1', { ...tasks.get('t1')!, dashAccess: true, jobId: null });
    await startTaskSession('t1');
    expect(settingsWrites[1]![1]).toMatchObject({ env: { DASH_CALLER: 'task:t1' } });
  });

  it('rewrites the settings file before waking a stopped job, which re-reads it', async () => {
    seed({ jobId: 'job-live' });
    sup.find.mockResolvedValueOnce({ cwd: '/wt/fix-login', sessionId: 's', state: 'stopped' });
    sup.respawn.mockImplementationOnce(async () => {
      expect(settingsWrites).toHaveLength(1);
    });
    await startTaskSession('t1');
    expect(sup.respawn).toHaveBeenCalledWith('job-live');
    expect(settingsWrites[0]![1]).toEqual({ env: { WEB_PORT: '3001' } });
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
