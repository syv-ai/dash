import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceRunner, type RunnerDeps } from '../ServiceRunner';
import type { TaskPort } from '../types';

function port(over: Partial<TaskPort>): TaskPort {
  return {
    id: 'id1',
    taskId: 't1',
    label: 'Web',
    envVar: 'WEB_PORT',
    defaultPort: 3000,
    hostPort: 3100,
    source: 'hash',
    runCommand: null,
    stopCommand: null,
    logsCommand: null,
    cwd: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

type RunOpts = Parameters<RunnerDeps['runTerminal']>[1];

let running: Set<string>;
let deps: {
  [K in keyof RunnerDeps]: ReturnType<typeof vi.fn>;
};
let runner: ServiceRunner;

beforeEach(() => {
  running = new Set();
  deps = {
    getTaskPath: vi.fn(() => '/wt'),
    getPorts: vi.fn(() => [] as TaskPort[]),
    portEnv: vi.fn(() => ({ SERVER_PORT: '11280' })),
    runTerminal: vi.fn(async (_t: string, o: RunOpts) => {
      running.add(o.key);
    }),
    stopTerminal: vi.fn((_t: string, key: string) => {
      running.delete(key);
    }),
    terminalRunning: vi.fn((_t: string, key: string) => running.has(key)),
    focusTerminal: vi.fn(),
    exec: vi.fn(async () => ({ code: 0, stderrTail: '' })),
    lsofPids: vi.fn(async () => [] as number[]),
    killPid: vi.fn(),
    liveness: vi.fn(() => 'down' as const),
    notifyChanged: vi.fn(),
    toast: vi.fn(),
    sleep: vi.fn(async () => {}),
  };
  runner = new ServiceRunner(deps as unknown as RunnerDeps);
});

const runCall = (i = 0) => deps.runTerminal.mock.calls[i]![1] as RunOpts;

describe('start', () => {
  it('runs the command in a terminal keyed by the label slug, with its cwd', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev', cwd: 'apps/web' }));
    expect(deps.runTerminal).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ key: 'web', label: 'Web', command: 'pnpm dev', cwd: 'apps/web' }),
    );
    expect(runner.isOwned('t1', 'Web')).toBe(true);
    expect(deps.notifyChanged).toHaveBeenCalledWith('t1');
  });

  it('runs with the allocated port env (the whole point of the wiring)', async () => {
    await runner.start('t1', port({ runCommand: 'npm run server' }));
    expect(deps.portEnv).toHaveBeenCalledWith('t1');
    expect(runCall().env).toEqual({ SERVER_PORT: '11280' });
  });

  it('no run command -> error result, no terminal', async () => {
    const r = await runner.start('t1', port({}));
    expect(r.ok).toBe(false);
    expect(deps.runTerminal).not.toHaveBeenCalled();
  });

  it('a failed start toasts and does not claim ownership', async () => {
    deps.runTerminal.mockRejectedValueOnce(new Error('spawn fail'));
    const r = await runner.start('t1', port({ runCommand: 'x' }));
    expect(r.ok).toBe(false);
    expect(deps.toast).toHaveBeenCalled();
    expect(runner.isOwned('t1', 'Web')).toBe(false);
  });
});

describe('stop chain', () => {
  it('owned + alive -> stops the terminal, no exec, no PID kill', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    await runner.stop('t1', port({ runCommand: 'pnpm dev' }));
    expect(deps.stopTerminal).toHaveBeenCalledWith('t1', 'web');
    expect(deps.exec).not.toHaveBeenCalled();
    expect(deps.lsofPids).not.toHaveBeenCalled();
  });

  it('not owned + stop command -> exec; failure does NOT fall through to PID kill', async () => {
    deps.exec.mockResolvedValueOnce({ code: 1, stderrTail: 'boom' });
    const r = await runner.stop('t1', port({ stopCommand: 'docker compose stop web' }));
    expect(deps.exec).toHaveBeenCalledWith('docker compose stop web', '/wt');
    expect(r.ok).toBe(false);
    expect(deps.lsofPids).not.toHaveBeenCalled();
    expect(deps.toast).toHaveBeenCalled();
  });

  it('runs the stop command in the service cwd', async () => {
    await runner.stop('t1', port({ stopCommand: 'y', cwd: 'apps/api' }));
    expect(deps.exec).toHaveBeenCalledWith('y', '/wt/apps/api');
  });

  it('not owned, no stop command -> SIGTERMs PIDs on the port', async () => {
    deps.lsofPids.mockResolvedValueOnce([4242]);
    const r = await runner.stop('t1', port({}));
    expect(deps.lsofPids).toHaveBeenCalledWith(3100);
    expect(deps.killPid).toHaveBeenCalledWith(4242);
    expect(r.ok).toBe(true);
  });

  it('no PIDs found -> informational toast, ok:false', async () => {
    const r = await runner.stop('t1', port({}));
    expect(r.ok).toBe(false);
    expect(deps.toast).toHaveBeenCalled();
  });

  it('owned but terminal dead -> falls through to stop command', async () => {
    await runner.start('t1', port({ runCommand: 'x', stopCommand: 'y' }));
    running.clear();
    await runner.stop('t1', port({ runCommand: 'x', stopCommand: 'y' }));
    expect(deps.exec).toHaveBeenCalledWith('y', '/wt');
  });
});

describe('logs', () => {
  it('owned + alive -> focuses the run terminal', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    await runner.logs('t1', port({ runCommand: 'pnpm dev' }));
    expect(deps.focusTerminal).toHaveBeenCalledWith('t1', 'web');
    expect(deps.runTerminal).toHaveBeenCalledTimes(1); // no extra spawn
  });

  it('not owned + logs command -> runs a :logs terminal (not ownership, no exit hook)', async () => {
    await runner.logs('t1', port({ logsCommand: 'docker compose logs -f web' }));
    expect(deps.runTerminal).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ key: 'web:logs', label: 'Web logs' }),
    );
    expect(runner.isOwned('t1', 'Web')).toBe(false);
    // Logs commands may reference ports too.
    expect(runCall().env).toEqual({ SERVER_PORT: '11280' });
    expect(runCall().onExit).toBeUndefined();
  });
});

describe('startAll', () => {
  it('starts every runnable, non-up service with a stagger; continues past failures', async () => {
    deps.getPorts.mockReturnValue([
      port({ label: 'A', hostPort: 1, runCommand: 'a' }),
      port({ label: 'B', hostPort: 2, runCommand: 'b' }),
      port({ label: 'C', hostPort: 3 }), // no run command
      port({ label: 'D', hostPort: 4, runCommand: 'd' }),
    ]);
    deps.liveness.mockImplementation((_tid: string, p: number) => (p === 2 ? 'up' : 'down'));
    deps.runTerminal.mockRejectedValueOnce(new Error('spawn fail')); // A fails
    const r = await runner.startAll('t1');
    // A attempted (failed), B skipped (up), C skipped (no run), D started.
    expect(deps.runTerminal).toHaveBeenCalledTimes(2);
    expect(r.failed).toEqual(['A']);
    expect(deps.sleep).toHaveBeenCalled();
  });
});

describe('stopAll', () => {
  it('stops only running services (Dash-owned or listening), skips idle ones', async () => {
    const a = port({ label: 'A', hostPort: 1, runCommand: 'a' });
    const b = port({ label: 'B', hostPort: 2, stopCommand: 'stop-b' });
    const c = port({ label: 'C', hostPort: 3, stopCommand: 'stop-c' });
    deps.getPorts.mockReturnValue([a, b, c]);
    deps.liveness.mockImplementation((_tid: string, p: number) => (p === 2 ? 'up' : 'down'));
    await runner.start('t1', a);

    const r = await runner.stopAll('t1');

    expect(deps.stopTerminal).toHaveBeenCalledWith('t1', 'a'); // owned -> terminal stop
    expect(deps.exec).toHaveBeenCalledWith('stop-b', '/wt'); // listening -> stop command
    expect(deps.exec).not.toHaveBeenCalledWith('stop-c', '/wt'); // idle -> skipped
    expect(r.stopped.sort()).toEqual(['A', 'B']);
  });
});

describe('ownership ends', () => {
  it('when the service dies on its own, and the drawer is told', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    deps.notifyChanged.mockClear();
    runCall().onExit!();
    expect(runner.isOwned('t1', 'Web')).toBe(false);
    expect(deps.notifyChanged).toHaveBeenCalledWith('t1');
  });

  it('when the user closes the tab', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    deps.notifyChanged.mockClear();
    runCall().onClosed!();
    expect(runner.isOwned('t1', 'Web')).toBe(false);
    expect(deps.notifyChanged).toHaveBeenCalledWith('t1');
  });

  it('when the task is forgotten, stopping its terminals', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    runner.forgetTask('t1');
    expect(deps.stopTerminal).toHaveBeenCalledWith('t1', 'web');
    expect(runner.isOwned('t1', 'Web')).toBe(false);
  });
});
