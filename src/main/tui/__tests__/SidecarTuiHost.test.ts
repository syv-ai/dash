import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SidecarTuiHost, type SpawnOpts, type WizardWiring } from '../SidecarTuiHost';

let dir: string;
let host: SidecarTuiHost;
let startPty: ReturnType<typeof vi.fn>;
let tabAdd: ReturnType<typeof vi.fn>;
let tabClose: ReturnType<typeof vi.fn>;
let tabSetActive: ReturnType<typeof vi.fn>;
let killPty: ReturnType<typeof vi.fn>;
let scriptPath: string;

function makeFlow(opts?: { failStart?: boolean }) {
  return {
    wiring: null as WizardWiring | null,
    start: vi.fn(async () => {
      if (opts?.failStart) throw new Error('flow start failed');
    }),
    teardown: vi.fn(async () => {}),
  };
}

function spawnOpts(flow: ReturnType<typeof makeFlow>, overrides?: Partial<SpawnOpts>): SpawnOpts {
  return {
    featureId: 'ports',
    taskId: 't1',
    projectId: 'p1',
    cwd: dir,
    cols: 80,
    rows: 24,
    tabLabel: 'Set up ports',
    createWizard: (wiring) => {
      flow.wiring = wiring;
      return flow;
    },
    getMainWindow: () => null,
    ...overrides,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-host-test-'));
  scriptPath = path.join(dir, 'tui.js');
  fs.writeFileSync(scriptPath, '// stub bundle');
  startPty = vi.fn(async () => ({}));
  tabAdd = vi.fn((_tid: string, o: { id: string }) => ({ id: o.id }));
  tabClose = vi.fn();
  tabSetActive = vi.fn();
  killPty = vi.fn();
  host = new SidecarTuiHost({
    socketDir: path.join(dir, 'sockets'),
    scriptPath,
    drawerTabs: { add: tabAdd as never, close: tabClose, setActive: tabSetActive },
    startPty: startPty as never,
    killPty,
  });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SidecarTuiHost', () => {
  it('spawn registers active; pending is set synchronously', async () => {
    const flow = makeFlow();
    const p = host.spawn(spawnOpts(flow));
    // Synchronous pending guard — the migrate path notifies the renderer
    // right after calling spawn() and relies on this being true already.
    expect(host.isActive('ports', 't1')).toBe(true);
    const { tabId } = await p;
    expect(tabId).toBe('tui:ports:t1');
    expect(host.isActive('ports', 't1')).toBe(true);
    expect(startPty).toHaveBeenCalledOnce();
    const env = (startPty.mock.calls[0][0] as { env: Record<string, string> }).env;
    expect(env.DASH_TUI_FEATURE).toBe('ports');
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(env.DASH_TUI_SOCKET).toContain('tui-ports-t1-');
  });

  it('isActive stays true while the spawn is still in flight (migrate relies on this)', async () => {
    // The side-car PTY + socket dance is slow; the migrate path fires the
    // ports:tui:migrated IPC right after calling spawn() WITHOUT awaiting it,
    // and the renderer's task-switch effect checks isActive() to avoid
    // double-spawning. That only works if the engagement is reserved up front
    // and stays reserved across every await inside spawn().
    let resolvePty: (() => void) | undefined;
    startPty.mockImplementationOnce(
      () =>
        new Promise<object>((res) => {
          resolvePty = () => res({});
        }),
    );
    const flow = makeFlow();
    const p = host.spawn(spawnOpts(flow));
    // Reserved synchronously, before any await resolves.
    expect(host.isActive('ports', 't1')).toBe(true);
    // Still true once the spawn has progressed all the way to the (hung) PTY
    // spawn — the exact window in which migrate notifies the renderer.
    await vi.waitFor(() => expect(startPty).toHaveBeenCalled());
    expect(host.isActive('ports', 't1')).toBe(true);
    resolvePty!();
    await p;
    expect(host.isActive('ports', 't1')).toBe(true);
  });

  it('teardown with a user reason drops active and suppresses respawn', async () => {
    const flow = makeFlow();
    await host.spawn(spawnOpts(flow));
    flow.wiring!.onTeardown('not-now');
    expect(tabClose).toHaveBeenCalledWith('tui:ports:t1');
    // Suppressed: still "active" from the renderer's point of view.
    expect(host.isActive('ports', 't1')).toBe(true);
  });

  it("teardown with reason 'error' does NOT suppress (retryable)", async () => {
    const flow = makeFlow();
    await host.spawn(spawnOpts(flow));
    flow.wiring!.onTeardown('error');
    expect(host.isActive('ports', 't1')).toBe(false);
  });

  it('rolls back tab + pending on PTY spawn failure and rethrows', async () => {
    startPty.mockRejectedValueOnce(new Error('pty boom'));
    const flow = makeFlow();
    await expect(host.spawn(spawnOpts(flow))).rejects.toThrow('pty boom');
    expect(flow.teardown).toHaveBeenCalled();
    expect(tabClose).toHaveBeenCalledWith('tui:ports:t1');
    // Not registered, not suppressed: a retry must be possible.
    expect(host.isActive('ports', 't1')).toBe(false);
  });

  it('missing bundle fails the spawn with a build hint', async () => {
    fs.rmSync(scriptPath);
    const flow = makeFlow();
    await expect(host.spawn(spawnOpts(flow))).rejects.toThrow(/pnpm build:tui/);
    expect(host.isActive('ports', 't1')).toBe(false);
  });

  it('same feature+task keys collide; different features coexist', async () => {
    const flow = makeFlow();
    await host.spawn(spawnOpts(flow));
    expect(host.isActive('ports', 't1')).toBe(true);
    expect(host.isActive('other', 't1')).toBe(false);
    expect(host.isActive('ports', 't2')).toBe(false);
  });

  it('spawn does not activate the tab by default; activate: true does', async () => {
    const flow = makeFlow();
    await host.spawn(spawnOpts(flow));
    expect(tabSetActive).not.toHaveBeenCalled();

    const flow2 = makeFlow();
    await host.spawn(spawnOpts(flow2, { taskId: 't2', activate: true }));
    expect(tabSetActive).toHaveBeenCalledWith('t2', 'tui:ports:t2');
  });

  it('handleRendererReload tears down active flows and clears suppression', async () => {
    const flow = makeFlow();
    await host.spawn(spawnOpts(flow));
    const flow2 = makeFlow();
    await host.spawn(spawnOpts(flow2, { taskId: 't2' }));
    flow2.wiring!.onTeardown('not-now'); // user declined earlier → suppressed

    await host.handleRendererReload();

    expect(flow.teardown).toHaveBeenCalled();
    expect(tabClose).toHaveBeenCalledWith('tui:ports:t1');
    expect(killPty).toHaveBeenCalledWith('tui:ports:t1');
    // A reload is a fresh session: both the live flow and the previously
    // suppressed key must be free to respawn.
    expect(host.isActive('ports', 't1')).toBe(false);
    expect(host.isActive('ports', 't2')).toBe(false);
  });

  it('sweepSockets removes tui-* and legacy ports-tui-* files', () => {
    const sockDir = path.join(dir, 'sockets');
    fs.mkdirSync(sockDir, { recursive: true });
    fs.writeFileSync(path.join(sockDir, 'tui-ports-x-aa.sock'), '');
    fs.writeFileSync(path.join(sockDir, 'ports-tui-x-aa.sock'), '');
    fs.writeFileSync(path.join(sockDir, 'other.sock'), '');
    host.sweepSockets();
    expect(fs.readdirSync(sockDir)).toEqual(['other.sock']);
  });
});
