import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskPort } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerServiceCapabilities } from '../services';

function port(over: Partial<TaskPort>): TaskPort {
  return {
    id: 'id1',
    taskId: 'me',
    label: 'Web',
    envVar: 'WEB_PORT',
    defaultPort: 3000,
    hostPort: 3100,
    source: 'hash',
    runCommand: 'pnpm dev',
    stopCommand: null,
    logsCommand: null,
    cwd: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const orch = { kind: 'orchestrator' } as const;
const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;

let registry: Registry;
let liveness: Record<number, 'up' | 'down' | 'unknown'>;
const ports = [
  port({}),
  port({ label: 'DB', envVar: 'DB_PORT', hostPort: 5500, runCommand: null }),
];
const runner = {
  findPort: vi.fn((_t: string, label: string) => ports.find((p) => p.label === label)),
  status: vi.fn(() => ({ Web: { ownedTabId: 'service:me:web' }, DB: { ownedTabId: null } })),
  start: vi.fn(async () => ({ ok: true })),
  stop: vi.fn(async () => ({ ok: false, message: 'Nothing listening on :5500' })),
  output: vi.fn(async (): Promise<string | null> => 'ready on :3100'),
};
const tasks = [
  makeTask({ id: 'me', projectId: 'pA', dashAccess: true }),
  makeTask({ id: 'sibling', projectId: 'pA' }),
  makeTask({ id: 'old', projectId: 'pA', archivedAt: '2026-01-03T00:00:00.000Z' }),
];
let deps: {
  getTask: ReturnType<typeof vi.fn>;
  getPorts: ReturnType<typeof vi.fn>;
  watchLiveness: ReturnType<typeof vi.fn>;
  getLiveness: ReturnType<typeof vi.fn>;
  runner: typeof runner;
  sleep: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  liveness = {};
  deps = {
    getTask: vi.fn((id: string) => tasks.find((t) => t.id === id)),
    getPorts: vi.fn(() => ports),
    watchLiveness: vi.fn(() => {
      liveness = { 3100: 'up', 5500: 'down' };
    }),
    getLiveness: vi.fn(() => liveness),
    runner,
    sleep: vi.fn(async () => {}),
  };
  registry = createRegistry(fakeLookups([makeProject({ id: 'pA' })], tasks));
  registerServiceCapabilities(registry, deps as never);
});

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof ControlError) return err.status;
    throw err;
  }
}

describe('services.list', () => {
  it("watches the task's ports, then lists them for the calling task by default", async () => {
    const result = await registry.call(asTask('me'), 'services.list', {});
    expect(deps.watchLiveness).toHaveBeenCalledWith('me', [3100, 5500]);
    expect(deps.watchLiveness.mock.invocationCallOrder[0]).toBeLessThan(
      deps.getLiveness.mock.invocationCallOrder[0]!,
    );
    expect(result).toEqual([
      {
        label: 'Web',
        envVar: 'WEB_PORT',
        hostPort: 3100,
        url: 'http://localhost:3100',
        liveness: 'up',
        hasRunCommand: true,
        running: true,
      },
      {
        label: 'DB',
        envVar: 'DB_PORT',
        hostPort: 5500,
        url: 'http://localhost:5500',
        liveness: 'down',
        hasRunCommand: false,
        running: false,
      },
    ]);
  });

  it('waits once for the first probe when liveness is still unknown', async () => {
    deps.watchLiveness.mockImplementation(() => {});
    await registry.call(asTask('me'), 'services.list', {});
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it('needs a taskId from the orchestrator, and scope still applies', async () => {
    expect(await status(registry.call(orch, 'services.list', {}))).toBe(400);
    expect(await status(registry.call(asTask('me'), 'services.list', { taskId: 'sibling' }))).toBe(
      404,
    );
  });
});

describe('services.start / stop / output', () => {
  it('starts and stops by label, passing the OpResult through', async () => {
    expect(await registry.call(asTask('me'), 'services.start', { label: 'Web' })).toEqual({
      ok: true,
    });
    expect(runner.start).toHaveBeenCalledWith('me', ports[0]);
    expect(await registry.call(orch, 'services.stop', { taskId: 'me', label: 'DB' })).toEqual({
      ok: false,
      message: 'Nothing listening on :5500',
    });
    expect(runner.stop).toHaveBeenCalledWith('me', ports[1]);
  });

  it('refuses an archived task', async () => {
    for (const name of ['services.start', 'services.stop']) {
      await expect(
        registry.call(orch, name, { taskId: 'old', label: 'Web' }),
      ).rejects.toMatchObject({ status: 409, message: 'old is archived; restore it first' });
    }
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.stop).not.toHaveBeenCalled();
  });

  it('404s an unknown label', async () => {
    expect(await status(registry.call(asTask('me'), 'services.start', { label: 'Nope' }))).toBe(
      404,
    );
    expect(await status(registry.call(asTask('me'), 'services.output', { label: 'Nope' }))).toBe(
      404,
    );
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("returns the run tab's text", async () => {
    expect(
      await registry.call(asTask('me'), 'services.output', { label: 'Web', lines: 20 }),
    ).toEqual({ text: 'ready on :3100' });
    expect(runner.output).toHaveBeenCalledWith('me', 'Web', 20);
  });

  it('404s output for a service Dash does not run', async () => {
    runner.output.mockResolvedValueOnce(null);
    await expect(
      registry.call(asTask('me'), 'services.output', { label: 'DB' }),
    ).rejects.toMatchObject({ status: 404, message: 'DB is not running in Dash' });
  });
});
