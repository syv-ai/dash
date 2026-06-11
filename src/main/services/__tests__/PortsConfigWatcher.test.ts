import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../WorkspacePortsRuntime', () => ({
  WorkspacePortsRuntime: { setupTask: vi.fn(() => []) },
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  startWatching,
  stopWatching,
  rearm,
  forceStop,
  stopAll,
  events,
} from '../PortsConfigWatcher';

// Real timers + real fs.watch — the 2s debounce makes these tests slow by
// design; they cover refcount semantics that only manifest through actual
// file events.
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

let worktree: string;

beforeEach(() => {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-watcher-test-'));
});

afterEach(() => {
  stopAll();
  fs.rmSync(worktree, { recursive: true, force: true });
});

describe('PortsConfigWatcher refcounts', () => {
  it('rearm arms a deferred watcher without taking a ref', async () => {
    // .dash/ doesn't exist yet — startWatching defers the fs.watch but
    // tracks the ref.
    startWatching('tA', worktree);
    const dashDir = path.join(worktree, '.dash');
    fs.mkdirSync(dashDir);
    rearm('tA');

    const wait = waitForConfigEvent('tA');
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[]}');
    expect(await wait).toBe(true);

    // rearm must NOT have incremented the refcount: a single stopWatching
    // closes the watcher.
    stopWatching('tA');
    const waitAfterStop = waitForConfigEvent('tA', 2600);
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[{"label":"x","port":80}]}');
    expect(await waitAfterStop).toBe(false);
  }, 15_000);

  it('stopping one of two holders keeps the watcher alive', async () => {
    const dashDir = path.join(worktree, '.dash');
    fs.mkdirSync(dashDir);
    startWatching('tB', worktree);
    startWatching('tB', worktree);
    stopWatching('tB');

    const wait = waitForConfigEvent('tB');
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[]}');
    expect(await wait).toBe(true);
  }, 15_000);

  it('forceStop closes the watcher despite outstanding refs', async () => {
    const dashDir = path.join(worktree, '.dash');
    fs.mkdirSync(dashDir);
    startWatching('tC', worktree);
    startWatching('tC', worktree);
    forceStop('tC');

    const wait = waitForConfigEvent('tC', 2600);
    fs.writeFileSync(path.join(dashDir, 'ports.json'), '{"ports":[]}');
    expect(await wait).toBe(false);

    // Outstanding holders calling stopWatching later must not throw.
    stopWatching('tC');
    stopWatching('tC');
  }, 15_000);
});
