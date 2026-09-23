import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  AddonContext,
  AddonSurfaces,
  Block,
  StorageScope,
  TaskInfo,
  WorktreeRef,
} from '@shared/addon-api';
import { createPortsAddon, type PortsDeps } from '../index';

const PORTS_JSON = JSON.stringify({
  version: 1,
  ports: [{ label: 'web', envVar: 'WEB_PORT', defaultPort: 3000, run: 'pnpm dev' }],
});

let root: string;
const tasks = new Map<string, TaskInfo>();

function addTask(id: string, name = id): TaskInfo {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const t: TaskInfo = { id, projectId: 'p1', name, path: dir, useWorktree: true, archived: false };
  tasks.set(id, t);
  return t;
}

/** An in-memory ctx: real storage semantics, recorded side effects. */
function fakeCtx() {
  const data = new Map<string, unknown>();
  const key = (scope: StorageScope, k: string) =>
    `${scope === 'global' ? 'g:' : 'project' in scope ? `p:${scope.project}` : `t:${scope.task}`}|${k}`;
  const env: Array<(wt: WorktreeRef) => Record<string, string>> = [];
  const listeners = new Map<string, Array<(t: TaskInfo) => void>>();
  const watchers = new Map<string, (files: string[]) => void>();
  const ctx = {
    session: {
      env: (fn: (wt: WorktreeRef) => Record<string, string>) => env.push(fn),
      path: vi.fn(),
      hooks: vi.fn(),
    },
    on: (e: string, fn: (t: TaskInfo) => void) =>
      listeners.set(e, [...(listeners.get(e) ?? []), fn]),
    storage: {
      get: <T>(s: StorageScope, k: string) => data.get(key(s, k)) as T | undefined,
      set: (s: StorageScope, k: string, v: unknown) => void data.set(key(s, k), v),
      delete: (s: StorageScope, k: string) => void data.delete(key(s, k)),
      list: <T>(kind: 'project' | 'task', k: string) =>
        [...data.entries()]
          .filter(([dk]) => dk.startsWith(kind === 'task' ? 't:' : 'p:') && dk.endsWith(`|${k}`))
          .map(([dk, value]) => ({ scopeId: dk.slice(2, dk.indexOf('|')), value: value as T })),
    },
    tasks: {
      get: (id: string) => tasks.get(id),
      list: () => [...tasks.values()],
      create: vi.fn(async ({ name }: { name: string }) => {
        const t = addTask('setup1', name);
        for (const fn of listeners.get('taskCreated') ?? []) fn(t);
        return t;
      }),
      activate: vi.fn(),
      restartSessions: vi.fn(),
      refreshHooks: vi.fn(async () => {}),
    },
    terminals: {
      run: vi.fn(async (_t: string, o: { key: string }) => ({ key: o.key, tabId: o.key })),
      stop: vi.fn(),
      isRunning: vi.fn(() => false),
      focus: vi.fn(),
    },
    files: {
      watch: vi.fn((taskId: string, _dir: string, fn: (files: string[]) => void) => {
        watchers.set(taskId, fn);
        return () => watchers.delete(taskId);
      }),
    },
    notify: { toast: vi.fn() },
    shell: {
      openUrl: vi.fn(),
      copy: vi.fn(),
      exec: vi.fn(async () => ({ code: 0, stderrTail: '' })),
    },
    paths: { data: '/data/ports' },
    setInterval: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    refresh: vi.fn(),
  } satisfies AddonContext;
  return {
    ctx,
    env: (wt: WorktreeRef) => Object.assign({}, ...env.map((f) => f(wt))) as Record<string, string>,
    emit: (e: string, t: TaskInfo) => (listeners.get(e) ?? []).forEach((fn) => fn(t)),
    fileChanged: (taskId: string, files = ['ports.json']) => watchers.get(taskId)?.(files),
    watching: (taskId: string) => watchers.has(taskId),
  };
}

function deps(over: Partial<PortsDeps> = {}): PortsDeps {
  return {
    detectPortsNeed: () => ({
      signals: ['vite (package.json)'],
      guesses: [{ label: 'web', envVar: 'WEB_PORT', defaultPort: 5173 }],
    }),
    isConfigured: (p) => fs.existsSync(path.join(p, '.dash', 'ports.json')),
    lsofPids: async () => [],
    killPid: vi.fn(),
    now: () => 1000,
    ...over,
  };
}

async function activate(d = deps()) {
  const f = fakeCtx();
  const surfaces = (await createPortsAddon(d).activate(f.ctx)) as AddonSurfaces;
  return { ...f, surfaces };
}

const buttonIds = (blocks: Block[]) => blocks.flatMap((b) => (b.type === 'button' ? [b.id] : []));

function writeConfig(task: TaskInfo, body = PORTS_JSON) {
  fs.mkdirSync(path.join(task.path, '.dash'), { recursive: true });
  fs.writeFileSync(path.join(task.path, '.dash', 'ports.json'), body);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ports-addon-'));
  tasks.clear();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ports add-on', () => {
  it('has a right-side drawer and is on by default', () => {
    const a = createPortsAddon(deps());
    expect(a.defaultEnabled).toBe(true);
    expect(a.drawerSide).toBe('right');
  });

  it('shows no drawer without a task, or for an in-place task', async () => {
    const { surfaces } = await activate();
    expect(surfaces.drawer!(null)).toBeNull();
    const t = addTask('t1');
    expect(surfaces.drawer!({ ...t, useWorktree: false })).toBeNull();
  });

  it('an unconfigured task offers Start setup', async () => {
    const { surfaces } = await activate();
    const d = surfaces.drawer!(addTask('t1'))!;
    expect(buttonIds(d.blocks)).toEqual(['start']);
  });

  it('Start setup creates the setup task with the prompt, activates it, and both drawers follow', async () => {
    const { ctx, surfaces } = await activate();
    const source = addTask('t1');
    await surfaces.onAction!({ surface: 'drawer', taskId: 't1' }, 'start');
    await vi.waitFor(() => expect(ctx.tasks.activate).toHaveBeenCalledWith('setup1'));

    expect(ctx.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', name: 'port-setup' }),
    );
    const prompt = (ctx.tasks.create.mock.calls[0]![0] as unknown as { initialPrompt: string })
      .initialPrompt;
    expect(prompt).toContain('vite (package.json)');
    expect(fs.existsSync(path.join(tasks.get('setup1')!.path, '.dash'))).toBe(true);

    const src = surfaces.drawer!(source)!;
    expect(buttonIds(src.blocks)).toEqual(['open-setup', 'dismiss']);
    const setup = surfaces.drawer!(tasks.get('setup1')!)!;
    expect(setup.blocks[0]).toMatchObject({ type: 'progress' });
  });

  it('a valid ports.json in the setup task allocates, toasts, and offers restart', async () => {
    const f = await activate();
    await f.surfaces.onAction!({ surface: 'drawer', taskId: addTask('t1').id }, 'start');
    await vi.waitFor(() => expect(f.ctx.tasks.activate).toHaveBeenCalled());
    const setupTask = tasks.get('setup1')!;

    writeConfig(setupTask, '{ not json');
    f.fileChanged('setup1');
    const invalid = f.surfaces.drawer!(setupTask)!;
    expect(invalid.blocks.some((b) => b.type === 'text' && b.tone === 'error')).toBe(true);

    writeConfig(setupTask);
    f.fileChanged('setup1');
    expect(f.ctx.notify.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Ports allocated' }),
    );
    expect(buttonIds(f.surfaces.drawer!(setupTask)!.blocks)).toEqual(['restart', 'dismiss']);

    await f.surfaces.onAction!({ surface: 'drawer', taskId: 'setup1' }, 'restart');
    expect(f.ctx.tasks.restartSessions).toHaveBeenCalledWith('setup1');
    // After restart the drawer shows the ports list.
    const list = f.surfaces.drawer!(setupTask)!;
    expect(list.summary).toMatch(/\/1 up$/);
  });

  it('a ports.json written while Dash was closed is picked up at activation', async () => {
    const setupTask = addTask('setup1');
    writeConfig(setupTask);
    const f = fakeCtx();
    f.ctx.storage.set({ task: 'setup1' }, 'setup', { kind: 'waiting', since: 0 });
    const surfaces = (await createPortsAddon(deps()).activate(f.ctx)) as AddonSurfaces;
    expect(buttonIds(surfaces.drawer!(setupTask)!.blocks)).toEqual(['restart', 'dismiss']);
  });

  it('a configured task lists its ports and injects their env', async () => {
    const f = await activate();
    const t = addTask('t1');
    writeConfig(t);
    f.emit('taskCreated', t);
    const d = f.surfaces.drawer!(t)!;
    const rows = d.blocks[0]!.type === 'list' ? d.blocks[0]!.rows : [];
    expect(rows.map((r) => r.label)).toEqual(['web']);
    const env = f.env({ path: t.path, taskId: t.id });
    expect(Number(env.WEB_PORT)).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(t.path, '.env.worktree'), 'utf-8')).toContain('WEB_PORT');
  });

  it('two tasks never get the same host port', async () => {
    const f = await activate();
    const a = addTask('a');
    const b = addTask('b');
    writeConfig(a);
    writeConfig(b);
    f.emit('taskCreated', a);
    f.emit('taskCreated', b);
    expect(f.env({ path: a.path, taskId: 'a' }).WEB_PORT).not.toBe(
      f.env({ path: b.path, taskId: 'b' }).WEB_PORT,
    );
  });

  it('run and open act on the named port', async () => {
    const f = await activate();
    const t = addTask('t1');
    writeConfig(t);
    f.emit('taskCreated', t);
    await f.surfaces.onAction!({ surface: 'drawer', taskId: 't1' }, 'run:web');
    expect(f.ctx.terminals.run).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ key: 'web', command: 'pnpm dev' }),
    );
    const port = f.env({ path: t.path, taskId: 't1' }).WEB_PORT;
    await f.surfaces.onAction!({ surface: 'drawer', taskId: 't1' }, 'open:web');
    expect(f.ctx.shell.openUrl).toHaveBeenCalledWith(`http://localhost:${port}`);
  });

  it('deleting a task stops watching it', async () => {
    const f = await activate();
    const t = addTask('t1');
    f.surfaces.drawer!(t);
    expect(f.watching('t1')).toBe(true);
    f.emit('taskDeleted', t);
    expect(f.watching('t1')).toBe(false);
  });

  it('a failed create shows Try again', async () => {
    const f = await activate();
    f.ctx.tasks.create.mockRejectedValueOnce(new Error('git says no'));
    const t = addTask('t1');
    await f.surfaces.onAction!({ surface: 'drawer', taskId: 't1' }, 'start');
    await vi.waitFor(() =>
      expect(buttonIds(f.surfaces.drawer!(t)!.blocks)).toEqual(['start', 'dismiss']),
    );
  });
});
