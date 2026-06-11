import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceRunner } from '../ServiceRunner';
import type { TaskPort } from '../../../shared/types';

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

let deps: {
  getTaskPath: ReturnType<typeof vi.fn>;
  getPorts: ReturnType<typeof vi.fn>;
  drawerTabsAdd: ReturnType<typeof vi.fn>;
  drawerTabsCloseIfExists: ReturnType<typeof vi.fn>;
  startPty: ReturnType<typeof vi.fn>;
  killPty: ReturnType<typeof vi.fn>;
  ptyAlive: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  lsofPids: ReturnType<typeof vi.fn>;
  killPid: ReturnType<typeof vi.fn>;
  liveness: ReturnType<typeof vi.fn>;
  notifyChanged: ReturnType<typeof vi.fn>;
  toast: ReturnType<typeof vi.fn>;
  focusTab: ReturnType<typeof vi.fn>;
  shell: string;
  sleep: ReturnType<typeof vi.fn>;
};
let runner: ServiceRunner;

beforeEach(() => {
  deps = {
    getTaskPath: vi.fn(() => '/wt'),
    getPorts: vi.fn(() => [] as TaskPort[]),
    drawerTabsAdd: vi.fn((_tid: string, o: { id: string }) => ({ id: o.id })),
    drawerTabsCloseIfExists: vi.fn(),
    startPty: vi.fn(async () => ({})),
    killPty: vi.fn(),
    ptyAlive: vi.fn(() => true),
    exec: vi.fn(async () => ({ code: 0, stderrTail: '' })),
    lsofPids: vi.fn(async () => [] as number[]),
    killPid: vi.fn(),
    liveness: vi.fn(() => 'down' as const),
    notifyChanged: vi.fn(),
    toast: vi.fn(),
    focusTab: vi.fn(),
    shell: '/bin/zsh',
    sleep: vi.fn(async () => {}),
  };
  runner = new ServiceRunner(deps as never);
});

describe('start', () => {
  it('spawns the run command in a service tab with merged cwd', async () => {
    const p = port({ runCommand: 'pnpm dev', cwd: 'apps/web' });
    deps.getPorts.mockReturnValue([p]); // status() enumerates the ports list
    await runner.start('t1', p);
    expect(deps.drawerTabsAdd).toHaveBeenCalledWith('t1', {
      kind: 'service',
      label: 'Web',
      featureId: 'ports',
      id: 'service:t1:web',
    });
    const opts = deps.startPty.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.command).toBe('/bin/zsh');
    expect(opts.args).toEqual(['-lc', 'pnpm dev']);
    expect(opts.cwd).toBe('/wt/apps/web');
    expect(opts.kind).toBe('service');
    expect(runner.status('t1').Web.ownedTabId).toBe('service:t1:web');
    expect(deps.notifyChanged).toHaveBeenCalledWith('t1');
  });

  it('re-running an owned service kills the old PTY first', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    expect(deps.killPty).toHaveBeenCalledWith('service:t1:web');
    expect(deps.startPty).toHaveBeenCalledTimes(2);
  });

  it('no run command -> error result, no spawn', async () => {
    const r = await runner.start('t1', port({}));
    expect(r.ok).toBe(false);
    expect(deps.startPty).not.toHaveBeenCalled();
  });
});

describe('stop chain', () => {
  it('owned + alive -> kills the PTY, no exec, no PID kill', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    await runner.stop('t1', port({ runCommand: 'pnpm dev' }));
    expect(deps.killPty).toHaveBeenCalledWith('service:t1:web');
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

  it('owned but PTY dead -> falls through to stop command', async () => {
    await runner.start('t1', port({ runCommand: 'x', stopCommand: 'y' }));
    deps.ptyAlive.mockReturnValue(false);
    await runner.stop('t1', port({ runCommand: 'x', stopCommand: 'y' }));
    expect(deps.exec).toHaveBeenCalledWith('y', '/wt');
  });
});

describe('logs', () => {
  it('owned + alive -> focuses the run tab', async () => {
    await runner.start('t1', port({ runCommand: 'pnpm dev' }));
    await runner.logs('t1', port({ runCommand: 'pnpm dev' }));
    expect(deps.focusTab).toHaveBeenCalledWith('t1', 'service:t1:web');
    expect(deps.startPty).toHaveBeenCalledTimes(1); // no extra spawn
  });

  it('not owned + logs command -> spawns a :logs tab (not recorded as ownership)', async () => {
    deps.ptyAlive.mockReturnValue(false);
    await runner.logs('t1', port({ logsCommand: 'docker compose logs -f web' }));
    expect(deps.drawerTabsAdd).toHaveBeenCalledWith('t1', {
      kind: 'service',
      label: 'Web logs',
      featureId: 'ports',
      id: 'service:t1:web:logs',
    });
    expect(runner.status('t1').Web?.ownedTabId ?? null).toBe(null);
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
    deps.startPty.mockRejectedValueOnce(new Error('spawn fail')); // A fails
    const r = await runner.startAll('t1');
    // A attempted (failed), B skipped (up), C skipped (no run), D started.
    expect(deps.startPty).toHaveBeenCalledTimes(2);
    expect(r.failed).toEqual(['A']);
    expect(deps.sleep).toHaveBeenCalled(); // stagger between starts
  });
});

describe('status', () => {
  it('drops ownership when the PTY died', async () => {
    const p = port({ runCommand: 'pnpm dev' });
    deps.getPorts.mockReturnValue([p]);
    await runner.start('t1', p);
    deps.ptyAlive.mockReturnValue(false);
    expect(runner.status('t1').Web.ownedTabId).toBe(null);
  });
});
