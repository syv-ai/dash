import { describe, it, expect, vi } from 'vitest';
import type { AddonContext, AddonSurfaces, Block, HookContribution } from '@shared/addon-api';
import { createRtkAddon, settingsBlocks, type RtkDeps } from '../index';
import type { RtkResolution } from '../types';

const MANAGED: RtkResolution = {
  path: '/data/rtk/bin/rtk',
  source: 'managed',
  version: 'rtk 0.9.0',
};

/** A minimal ctx that records what the add-on registers. */
function fakeCtx() {
  const path: Array<() => string[]> = [];
  const hooks: Array<() => HookContribution[]> = [];
  const ctx = {
    session: {
      env: vi.fn(),
      path: (fn: () => string[]) => path.push(fn),
      hooks: (fn: () => HookContribution[]) => hooks.push(fn),
    },
    on: vi.fn(),
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn(() => []) },
    tasks: {
      get: vi.fn(),
      list: vi.fn(() => []),
      create: vi.fn(),
      activate: vi.fn(),
      restartSessions: vi.fn(),
      refreshHooks: vi.fn(async () => {}),
    },
    terminals: { run: vi.fn(), stop: vi.fn(), isRunning: vi.fn(), focus: vi.fn() },
    files: { watch: vi.fn(() => () => {}) },
    notify: { toast: vi.fn() },
    shell: { openUrl: vi.fn(), copy: vi.fn(), exec: vi.fn() },
    paths: { data: '/data/rtk' },
    setInterval: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    refresh: vi.fn(),
  } satisfies AddonContext;
  return {
    ctx,
    pathDirs: () => path.flatMap((f) => f()),
    hookEntries: () => hooks.flatMap((f) => f()),
  };
}

function deps(overrides: Partial<RtkDeps> = {}): RtkDeps {
  return {
    migrateLegacyBinary: vi.fn(),
    resolveBinary: vi.fn(async () => null),
    linkIntoUserPath: vi.fn(),
    download: vi.fn(async () => MANAGED),
    runHookTest: vi.fn(async () => ({
      ok: true as const,
      testedCommand: 'git status',
      rawOutput: '',
      outcome: { kind: 'pass-through' as const },
    })),
    isPlatformDownloadable: () => true,
    ...overrides,
  };
}

async function activate(d: RtkDeps) {
  const f = fakeCtx();
  const surfaces = (await createRtkAddon(d).activate(f.ctx)) as AddonSurfaces;
  return { ...f, surfaces };
}

const labels = (blocks: Block[]) =>
  blocks.map((b) => (b.type === 'button' ? `button:${b.id}` : b.type === 'text' ? b.text : b.type));

describe('RTK add-on', () => {
  it('is off by default and has no drawer', () => {
    const addon = createRtkAddon(deps());
    expect(addon.defaultEnabled).toBe(false);
  });

  it('contributes nothing without a binary', async () => {
    const { pathDirs, hookEntries, surfaces } = await activate(deps());
    expect(pathDirs()).toEqual([]);
    expect(hookEntries()).toEqual([]);
    expect(surfaces.drawer).toBeUndefined();
  });

  it('with a managed binary: quoted Bash hook, bin dir on PATH, symlink backfilled', async () => {
    const d = deps({ resolveBinary: vi.fn(async () => MANAGED) });
    const { pathDirs, hookEntries } = await activate(d);
    expect(hookEntries()).toEqual([
      { event: 'PreToolUse', matcher: 'Bash', command: "'/data/rtk/bin/rtk' hook claude" },
    ]);
    expect(pathDirs()).toEqual(['/data/rtk/bin']);
    expect(d.migrateLegacyBinary).toHaveBeenCalledWith('/data/rtk');
    expect(d.linkIntoUserPath).toHaveBeenCalledWith(MANAGED.path);
  });

  it('with a PATH binary: hook but no PATH change', async () => {
    const onPath: RtkResolution = { path: '/usr/local/bin/rtk', source: 'path', version: 'x' };
    const { pathDirs, hookEntries } = await activate(
      deps({ resolveBinary: vi.fn(async () => onPath) }),
    );
    expect(hookEntries()).toHaveLength(1);
    expect(pathDirs()).toEqual([]);
  });

  it('install downloads, refreshes hooks, starts contributing, and toasts', async () => {
    const d = deps();
    const { ctx, surfaces, hookEntries } = await activate(d);
    await surfaces.onAction!({ surface: 'settings' }, 'install');
    expect(d.download).toHaveBeenCalledOnce();
    expect(ctx.tasks.refreshHooks).toHaveBeenCalled();
    expect(hookEntries()).toHaveLength(1);
    expect(ctx.notify.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'RTK rtk 0.9.0 installed' }),
    );
  });

  it('a failed install toasts and keeps the previous binary', async () => {
    const d = deps({
      resolveBinary: vi.fn(async () => MANAGED),
      download: vi.fn(async () => {
        throw new Error('checksum mismatch');
      }),
    });
    const { ctx, surfaces, hookEntries } = await activate(d);
    await surfaces.onAction!({ surface: 'settings' }, 'install');
    expect(ctx.notify.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', body: 'checksum mismatch' }),
    );
    expect(hookEntries()[0]!.command).toContain(MANAGED.path);
  });

  it('test runs the hook test against the resolved binary', async () => {
    const d = deps({ resolveBinary: vi.fn(async () => MANAGED) });
    const { surfaces } = await activate(d);
    await surfaces.onAction!({ surface: 'settings' }, 'test');
    expect(d.runHookTest).toHaveBeenCalledWith(MANAGED, '/data/rtk/bin');
    expect(labels(surfaces.settings!())).toContain(
      'RTK left “git status” unchanged (pass-through).',
    );
  });
});

describe('RTK settings blocks', () => {
  const base = {
    resolved: null,
    downloadable: true,
    installProgress: null,
    installing: false,
    testing: false,
    testResult: null,
  };

  it('not installed: offers Install, no Test', () => {
    const l = labels(settingsBlocks(base));
    expect(l).toContain('button:install');
    expect(l).not.toContain('button:test');
  });

  it('managed install: offers Update and Test', () => {
    const blocks = settingsBlocks({ ...base, resolved: MANAGED });
    const install = blocks.find((b) => b.type === 'button' && b.id === 'install');
    expect(install).toMatchObject({ label: 'Update RTK' });
    expect(labels(blocks)).toContain('button:test');
  });

  it('PATH install: Test only, Dash does not update it', () => {
    const l = labels(
      settingsBlocks({ ...base, resolved: { path: '/usr/bin/rtk', source: 'path', version: 'x' } }),
    );
    expect(l).not.toContain('button:install');
    expect(l).toContain('button:test');
  });

  it('shows download progress while installing', () => {
    const blocks = settingsBlocks({
      ...base,
      installing: true,
      installProgress: { phase: 'downloading', percent: 40 },
    });
    expect(blocks).toContainEqual({ type: 'progress', label: 'Downloading RTK…', value: 0.4 });
  });

  it('no release for the platform: says so', () => {
    const l = labels(settingsBlocks({ ...base, downloadable: false }));
    expect(l).not.toContain('button:install');
    expect(l.some((t) => t.startsWith('No RTK release'))).toBe(true);
  });

  it('a rewrite shows the savings and the compressed output', () => {
    const blocks = settingsBlocks({
      ...base,
      resolved: MANAGED,
      testResult: {
        ok: true,
        testedCommand: 'git status',
        rawOutput: '',
        outcome: {
          kind: 'rewritten',
          rewrittenCommand: 'rtk git status',
          execDiff: {
            kind: 'ok',
            rawStdout: 'long',
            compressedStdout: 'short',
            rawBytes: 1000,
            compressedBytes: 250,
            truncated: false,
          },
        },
      },
    });
    const l = labels(blocks);
    expect(l).toContain('1000 → 250 bytes (75% smaller)');
    expect(blocks).toContainEqual({
      type: 'code',
      text: 'short',
      label: 'rtk git status output',
    });
  });
});
