import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../WorkspacePortsRuntime', () => ({
  WorkspacePortsRuntime: { setupTask: vi.fn(() => []) },
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ensureWatching, stop, stopAll, events } from '../PortsConfigWatcher';

// Real timers + real fs.watch — the 2s debounce makes these tests slow by
// design; they cover arming/teardown semantics that only manifest through
// actual file events.
const DEBOUNCE_MARGIN_MS = 3500;

function waitForConfigEvent(taskId: string, timeoutMs = DEBOUNCE_MARGIN_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = (payload: { taskId: string }) => {
      if (payload.taskId !== taskId) return;
      events.off('ports:config', handler);
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      events.off('ports:config', handler);
      resolve(false);
    }, timeoutMs);
    events.on('ports:config', handler);
  });
}

function waitForConfigError(
  taskId: string,
  timeoutMs = DEBOUNCE_MARGIN_MS,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const handler = (payload: { taskId: string; errors: string[] }) => {
      if (payload.taskId !== taskId) return;
      events.off('ports:configError', handler);
      clearTimeout(timer);
      resolve(payload.errors);
    };
    const timer = setTimeout(() => {
      events.off('ports:configError', handler);
      resolve(null);
    }, timeoutMs);
    events.on('ports:configError', handler);
  });
}

let worktree: string;

beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-watcher-test-'));
});

afterEach(() => {
  stopAll();
  fs.rmSync(worktree, { recursive: true, force: true });
});

describe('PortsConfigWatcher lifecycle', () => {
  it('ensureWatching retries a deferred arm once .dash/ exists', async () => {
    // .dash/ doesn't exist yet — the fs.watch is deferred but the entry is kept.
    ensureWatching('tA', worktree);
    const dashDir = path.join(worktree, '.dash');
    fs.mkdirSync(dashDir);
    ensureWatching('tA', worktree); // retries the arm

    // Give the freshly-armed fs.watch a beat to attach before the write —
    // under full-suite load macOS FSEvents can miss a write that lands in
    // the same tick as the watch registration.
    await new Promise((r) => setTimeout(r, 250));
    const wait = waitForConfigEvent('tA', 7000);
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[]}');
    expect(await wait).toBe(true);
  }, 15_000);

  it('ensureWatching is idempotent — repeated calls emit one event per write', async () => {
    const dashDir = path.join(worktree, '.dash');
    fs.mkdirSync(dashDir);
    ensureWatching('tB', worktree);
    ensureWatching('tB', worktree);
    ensureWatching('tB', worktree);

    let count = 0;
    const handler = (payload: { taskId: string }) => {
      if (payload.taskId === 'tB') count++;
    };
    events.on('ports:config', handler);
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[]}');
    await new Promise((r) => setTimeout(r, DEBOUNCE_MARGIN_MS));
    events.off('ports:config', handler);
    expect(count).toBe(1);
  }, 15_000);

  it('routes setupTask validation errors to ports:configError (not ports:config)', async () => {
    const { WorkspacePortsRuntime } = await import('../WorkspacePortsRuntime');
    (WorkspacePortsRuntime.setupTask as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_args: unknown, errors?: string[]) => {
        errors?.push('ports[0].envVar must match /^[A-Z_]/');
        return [];
      },
    );
    const dashDir = path.join(worktree, '.dash');
    fs.mkdirSync(dashDir);
    ensureWatching('tD', worktree);
    await new Promise((r) => setTimeout(r, 250));

    // The valid-config event must NOT also fire for the same (invalid) write.
    // Both emit synchronously in notifyConfigChanged, so a flag is sufficient.
    let configFired = false;
    const configFlag = (p: { taskId: string }) => {
      if (p.taskId === 'tD') configFired = true;
    };
    events.on('ports:config', configFlag);

    const errPromise = waitForConfigError('tD', 7000);
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[{"label":"x"}]}');
    expect(await errPromise).toEqual(['ports[0].envVar must match /^[A-Z_]/']);
    events.off('ports:config', configFlag);
    expect(configFired).toBe(false);
  }, 15_000);

  it('stop closes the watcher; no events after', async () => {
    const dashDir = path.join(worktree, '.dash');
    fs.mkdirSync(dashDir);
    ensureWatching('tC', worktree);
    stop('tC');

    const wait = waitForConfigEvent('tC', 2600);
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[]}');
    expect(await wait).toBe(false);

    // stop is idempotent.
    stop('tC');
    stop('tC');
  }, 15_000);
});
