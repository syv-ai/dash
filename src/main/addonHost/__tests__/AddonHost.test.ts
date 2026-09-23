import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  button,
  defineAddon,
  text,
  type Addon,
  type AddonContext,
  type AddonSurfaces,
  type TaskInfo,
} from '@shared/addon-api';
import { AddonHost, type HostDeps } from '../AddonHost';
import { createAddonStore, ensureAddonTables } from '../addonStore';

const TASK: TaskInfo = {
  id: 't1',
  projectId: 'p1',
  name: 'task',
  path: '/wt/t1',
  useWorktree: true,
  archived: false,
};

function makeDeps(overrides: Partial<HostDeps> = {}) {
  const db = new Database(':memory:');
  ensureAddonTables(db);
  const disposedWatches: string[] = [];
  const stopped: string[] = [];
  const deps: HostDeps = {
    store: createAddonStore(db),
    reservedEnvKeys: new Set(['PATH', 'HOME']),
    dataDir: (id) => `/data/${id}`,
    tasks: {
      get: (id) => (id === TASK.id ? TASK : undefined),
      list: () => [TASK],
      create: vi.fn(async () => TASK),
      activate: vi.fn(),
      restartSessions: vi.fn(),
      refreshHooks: vi.fn(async () => {}),
    },
    terminals: {
      run: vi.fn(async (_a, taskId, opts) => ({
        key: opts.key,
        tabId: `tab:${taskId}:${opts.key}`,
      })),
      stop: vi.fn((_a, taskId, key) => {
        stopped.push(`${taskId}:${key}`);
      }),
      isRunning: () => false,
      focus: vi.fn(),
    },
    watchDir: (taskId, relDir) => () => disposedWatches.push(`${taskId}:${relDir}`),
    toast: vi.fn(),
    openUrl: vi.fn(),
    copy: vi.fn(),
    exec: vi.fn(async () => ({ code: 0, stderrTail: '' })),
    emitChanged: vi.fn(),
    notifyEnvChanged: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    activateTimeoutMs: 50,
    refreshDebounceMs: 0,
    ...overrides,
  };
  return { deps, disposedWatches, stopped };
}

/** An add-on that records its ctx and returns whatever surfaces the test gives it. */
function probe(
  id: string,
  surfaces: (ctx: AddonContext) => AddonSurfaces,
  extra: Partial<Addon> = {},
): Addon & { ctx?: AddonContext } {
  const addon: Addon & { ctx?: AddonContext } = defineAddon({
    id,
    name: id.toUpperCase(),
    description: `${id} add-on`,
    defaultEnabled: true,
    activate(ctx) {
      addon.ctx = ctx;
      return surfaces(ctx);
    },
    ...extra,
  });
  return addon;
}

describe('AddonHost', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('activates enabled add-ons and skips disabled ones', async () => {
    const on = probe('on', () => ({}));
    const off = probe('off', () => ({}), { defaultEnabled: false });
    const { deps } = makeDeps();
    const host = new AddonHost([on, off], deps);
    await host.start();
    expect(host.list().map((a) => [a.id, a.status])).toEqual([
      ['on', 'active'],
      ['off', 'disabled'],
    ]);
  });

  it('announces each add-on once its activation settles, failed or not', async () => {
    const good = probe('good', () => ({}));
    const bad = probe('bad', () => {
      throw new Error('boom');
    });
    const { deps } = makeDeps();
    const host = new AddonHost([good, bad], deps);
    await host.start();
    expect(deps.emitChanged).toHaveBeenCalledWith('good');
    expect(deps.emitChanged).toHaveBeenCalledWith('bad');
  });

  it('a stored enable state overrides the default', async () => {
    const off = probe('off', () => ({}), { defaultEnabled: false });
    const { deps } = makeDeps();
    deps.store.setEnabled('off', true);
    const host = new AddonHost([off], deps);
    await host.start();
    expect(host.list()[0]!.status).toBe('active');
  });

  it('marks a throwing activation failed without blocking others', async () => {
    const bad = probe('bad', () => {
      throw new Error('boom');
    });
    const good = probe('good', () => ({}));
    const { deps } = makeDeps();
    const host = new AddonHost([bad, good], deps);
    await host.start();
    const [b, g] = host.list();
    expect(b).toMatchObject({ status: 'failed', error: 'boom' });
    expect(g!.status).toBe('active');
  });

  it('times out a slow activation and undoes what it registered', async () => {
    const slow = defineAddon({
      id: 'slow',
      name: 'Slow',
      description: '',
      defaultEnabled: true,
      activate: (ctx) => {
        ctx.session.env(() => ({ SLOW: '1' }));
        return new Promise<AddonSurfaces>(() => {});
      },
    });
    const { deps } = makeDeps();
    const host = new AddonHost([slow], deps);
    await host.start();
    expect(host.list()[0]).toMatchObject({ status: 'failed' });
    expect(host.list()[0]!.error).toMatch(/timed out/);
    expect(host.envFor({ path: '/wt/t1', taskId: 't1' })).toEqual({});
  });

  it('disabling undoes every registration and calls dispose', async () => {
    const dispose = vi.fn();
    const listener = vi.fn();
    const interval = vi.fn();
    const addon = probe('a', (ctx) => {
      ctx.session.env(() => ({ A: '1' }));
      ctx.session.path(() => ['/bin/a']);
      ctx.session.hooks(() => [{ event: 'PreToolUse', matcher: 'Bash', command: 'a' }]);
      ctx.on('taskCreated', listener);
      ctx.files.watch('t1', '.dash', () => {});
      ctx.setInterval(interval, 5);
      return { dispose };
    });
    const { deps, disposedWatches, stopped } = makeDeps();
    const host = new AddonHost([addon], deps);
    await host.start();
    await addon.ctx!.terminals.run('t1', { key: 'web', label: 'web', command: 'npm start' });

    await host.setEnabled('a', false);

    expect(dispose).toHaveBeenCalledOnce();
    expect(disposedWatches).toEqual(['t1:.dash']);
    expect(stopped).toEqual(['t1:web']);
    expect(host.envFor({ path: '/wt/t1', taskId: 't1' })).toEqual({});
    expect(host.pathDirs()).toEqual([]);
    expect(host.hookEntries()).toEqual([]);
    host.emit('taskCreated', TASK);
    expect(listener).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(interval).not.toHaveBeenCalled();
    expect(deps.store.getEnabled('a')).toBe(false);
    expect(deps.tasks.refreshHooks).toHaveBeenCalled();
    expect(deps.notifyEnvChanged).toHaveBeenCalledWith('a');
    expect(deps.emitChanged).toHaveBeenCalledWith('a');
  });

  it('re-enabling activates again live', async () => {
    const activate = vi.fn(() => ({}));
    const addon = defineAddon({
      id: 'a',
      name: 'A',
      description: '',
      defaultEnabled: true,
      activate,
    });
    const { deps } = makeDeps();
    const host = new AddonHost([addon], deps);
    await host.start();
    await host.setEnabled('a', false);
    await host.setEnabled('a', true);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(host.list()[0]!.status).toBe('active');
    expect(deps.notifyEnvChanged).not.toHaveBeenCalled();
  });

  it('merges env in add-on order, drops reserved keys, skips a throwing contributor', async () => {
    const a = probe('a', (ctx) => {
      ctx.session.env(() => ({ SHARED: 'a', A: '1', PATH: '/evil' }));
      return {};
    });
    const b = probe('b', (ctx) => {
      ctx.session.env(() => {
        throw new Error('nope');
      });
      ctx.session.env(({ taskId }) => ({ SHARED: 'b', TASK: String(taskId) }));
      return {};
    });
    const { deps } = makeDeps();
    const host = new AddonHost([a, b], deps);
    await host.start();
    expect(host.envFor({ path: '/wt/t1', taskId: 't1' })).toEqual({
      SHARED: 'b',
      A: '1',
      TASK: 't1',
    });
  });

  it('aggregates PATH dirs de-duplicated and hook entries', async () => {
    const a = probe('a', (ctx) => {
      ctx.session.path(() => ['/x', '/y']);
      ctx.session.hooks(() => [{ event: 'PreToolUse', matcher: 'Bash', command: 'a hook' }]);
      return {};
    });
    const b = probe('b', (ctx) => {
      ctx.session.path(() => ['/y', '/z']);
      return {};
    });
    const { deps } = makeDeps();
    const host = new AddonHost([a, b], deps);
    await host.start();
    expect(host.pathDirs()).toEqual(['/x', '/y', '/z']);
    expect(host.hookEntries()).toEqual([
      { event: 'PreToolUse', matcher: 'Bash', command: 'a hook' },
    ]);
  });

  it('reports hasDrawer only for add-ons with a drawer surface', async () => {
    const withDrawer = probe('d', () => ({ drawer: () => null }), { drawerSide: 'left' });
    const without = probe('s', () => ({ settings: () => [] }));
    const { deps } = makeDeps();
    const host = new AddonHost([withDrawer, without], deps);
    await host.start();
    expect(host.list().map((a) => [a.id, a.hasDrawer, a.drawerSide])).toEqual([
      ['d', true, 'left'],
      ['s', false, 'right'],
    ]);
  });

  it('evaluates surfaces for a task and isolates a throwing one', async () => {
    const good = probe('good', () => ({
      settings: () => [text('ok')],
      drawer: (task) => (task ? { title: 'Good', blocks: [button('go', 'Go')] } : null),
    }));
    const bad = probe('bad', () => ({
      settings: () => [text('fine')],
      drawer: () => {
        throw new Error('drawer broke');
      },
    }));
    const invalid = probe('invalid', () => ({
      drawer: () => ({ title: '', blocks: [] }),
    }));
    const { deps } = makeDeps();
    const host = new AddonHost([good, bad, invalid], deps);
    await host.start();

    const [g, b, i] = host.surfacesFor('t1');
    expect(g).toEqual({
      addonId: 'good',
      settings: [text('ok')],
      drawer: { title: 'Good', blocks: [button('go', 'Go')] },
    });
    expect(b).toEqual({
      addonId: 'bad',
      settings: [text('fine')],
      drawerError: 'BAD: drawer broke',
    });
    expect(i!.drawer).toBeUndefined();
    expect(i!.drawerError).toMatch(/^INVALID:/);

    // No task: drawer returns null and is omitted.
    expect(host.surfacesFor(null)[0]).toEqual({ addonId: 'good', settings: [text('ok')] });
  });

  it('routes actions and toasts a failing one', async () => {
    const onAction = vi.fn(async (_ref, id: string) => {
      if (id === 'fail') throw new Error('nope');
    });
    const addon = probe('a', () => ({ onAction }));
    const { deps } = makeDeps();
    const host = new AddonHost([addon], deps);
    await host.start();
    await host.action('a', { surface: 'drawer', taskId: 't1' }, 'go');
    expect(onAction).toHaveBeenCalledWith({ surface: 'drawer', taskId: 't1' }, 'go');
    await host.action('a', { surface: 'settings' }, 'fail');
    expect(deps.toast).toHaveBeenCalledWith({ kind: 'error', title: 'A: nope' });
  });

  it('delivers task events and survives a throwing listener', async () => {
    const seen: string[] = [];
    const a = probe('a', (ctx) => {
      ctx.on('taskCreated', () => {
        throw new Error('x');
      });
      ctx.on('taskCreated', (t) => seen.push(`a:${t.id}`));
      return {};
    });
    const b = probe('b', (ctx) => {
      ctx.on('taskDeleted', (t) => seen.push(`b:${t.id}`));
      return {};
    });
    const { deps } = makeDeps();
    const host = new AddonHost([a, b], deps);
    await host.start();
    host.emit('taskCreated', TASK);
    host.emit('taskDeleted', TASK);
    expect(seen).toEqual(['a:t1', 'b:t1']);
  });

  it('refresh emits a change for that add-on', async () => {
    const addon = probe('a', () => ({}));
    const { deps } = makeDeps();
    const host = new AddonHost([addon], deps);
    await host.start();
    vi.mocked(deps.emitChanged).mockClear(); // activation announces itself once
    addon.ctx!.refresh();
    addon.ctx!.refresh();
    await new Promise((r) => setTimeout(r, 5));
    expect(deps.emitChanged).toHaveBeenCalledTimes(1);
    expect(deps.emitChanged).toHaveBeenCalledWith('a');
  });

  it('routes a closed drawer tab to the terminal that owns it', async () => {
    const onClosed = vi.fn();
    const addon = probe('a', () => ({}));
    const { deps } = makeDeps();
    const host = new AddonHost([addon], deps);
    await host.start();
    const handle = await addon.ctx!.terminals.run('t1', {
      key: 'web',
      label: 'web',
      command: 'x',
      onClosed,
    });
    host.terminalClosed('tab:other');
    expect(onClosed).not.toHaveBeenCalled();
    host.terminalClosed(handle.tabId);
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('scopes storage and the data dir to the add-on', async () => {
    const a = probe('a', () => ({}));
    const b = probe('b', () => ({}));
    const { deps } = makeDeps();
    const host = new AddonHost([a, b], deps);
    await host.start();
    a.ctx!.storage.set({ task: 't1' }, 'k', 'from a');
    expect(b.ctx!.storage.get({ task: 't1' }, 'k')).toBeUndefined();
    expect(a.ctx!.storage.get({ task: 't1' }, 'k')).toBe('from a');
    expect(a.ctx!.paths.data).toBe('/data/a');
  });

  it('stop tears down without touching enable state', async () => {
    const dispose = vi.fn();
    const addon = probe('a', () => ({ dispose }));
    const { deps } = makeDeps();
    const host = new AddonHost([addon], deps);
    await host.start();
    await host.stop();
    expect(dispose).toHaveBeenCalledOnce();
    expect(deps.store.getEnabled('a')).toBeUndefined();
  });
});
