import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { Project, Task } from '../../../shared/types';

vi.mock('../../terminal/SessionRegistry', () => ({
  sessionRegistry: {
    dispose: vi.fn(),
    disposeByPrefix: vi.fn(),
    restartAllForTask: vi.fn(),
  },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
const playNotificationSound = vi.fn();
const playPeonSound = vi.fn();
vi.mock('../../sounds', () => ({
  playNotificationSound: (...a: unknown[]) => playNotificationSound(...a),
  playPeonSound: (...a: unknown[]) => playPeonSound(...a),
}));

const proj = (id: string, over: Partial<Project> = {}): Project =>
  ({
    id,
    name: id,
    path: `/p/${id}`,
    isGitRepo: true,
    gitRemote: null,
    gitBranch: 'main',
    ...over,
  }) as Project;
const task = (id: string, projectId: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    projectId,
    name: id,
    branch: 'b',
    path: `/wt/${id}`,
    useWorktree: true,
    archivedAt: null,
    ...over,
  }) as Task;

async function freshStores() {
  vi.resetModules();
  const rt = await import('../runtimeStore');
  const projects = await import('../projectsStore');
  const settings = await import('../settingsStore');
  return {
    useRuntime: rt.useRuntime,
    useProjects: projects.useProjects,
    useSettings: settings.useSettings,
  };
}

describe('runtimeStore.refreshTokenRollups', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('fetches global + per-project stats for the loaded projects', async () => {
    api.getGlobalTokenStats = vi.fn(() =>
      Promise.resolve({ success: true, data: { totalTokens: 100, totalCostUsd: 1, taskCount: 3 } }),
    );
    api.getProjectTokenStats = vi.fn((id: string) =>
      Promise.resolve({
        success: true,
        data: { totalTokens: id === 'p1' ? 60 : 40, totalCostUsd: 0.5, taskCount: 1 },
      }),
    );
    const { useRuntime, useProjects } = await freshStores();
    useProjects.setState({ projects: [proj('p1'), proj('p2')] });

    await useRuntime.getState().refreshTokenRollups();

    expect(useRuntime.getState().globalTokenStats).toEqual({
      totalTokens: 100,
      totalCostUsd: 1,
      taskCount: 3,
    });
    expect(useRuntime.getState().projectTokenStats.p1!.totalTokens).toBe(60);
    expect(useRuntime.getState().projectTokenStats.p2!.totalTokens).toBe(40);
  });
});

describe('runtimeStore.init — activity', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  let activityCb: ((data: Record<string, { state: string }>) => void) | null;
  beforeEach(() => {
    vi.useFakeTimers();
    activityCb = null;
    playNotificationSound.mockClear();
    playPeonSound.mockClear();
    api = makeElectronApiMock();
    api.onPtyActivity = vi.fn((cb: (d: Record<string, { state: string }>) => void) => {
      activityCb = cb;
      return vi.fn();
    });
    api.ptyGetAllActivity = vi.fn(() => Promise.resolve({ success: true, data: {} }));
    installWindow(api);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetWindow();
  });

  it('stores the latest activity snapshot', async () => {
    const { useRuntime } = await freshStores();
    const cleanup = useRuntime.getState().init();
    activityCb!({ a: { state: 'busy' } });
    expect(useRuntime.getState().taskActivity).toEqual({ a: { state: 'busy' } });
    cleanup();
  });

  it('plays the done sound and marks non-active tasks unseen on a real busy→idle', async () => {
    const { useRuntime, useProjects, useSettings } = await freshStores();
    useProjects.setState({ activeTaskId: 'active' });
    const setUnseenTaskIds = vi.fn();
    useSettings.setState({ notificationSound: 'default', setUnseenTaskIds } as never);
    const cleanup = useRuntime.getState().init();

    activityCb!({ x: { state: 'idle' } }); // establish hasBeenIdle
    activityCb!({ x: { state: 'busy' } }); // busy starts
    vi.advanceTimersByTime(4000); // exceed the 3s min-busy guard
    activityCb!({ x: { state: 'idle' } }); // busy→idle = done

    expect(playNotificationSound).toHaveBeenCalledWith('default');
    expect(setUnseenTaskIds).toHaveBeenCalled();
    cleanup();
  });

  it('treats a supervisor-stopped session as rested, and busy→stopped as not done', async () => {
    const { useRuntime, useProjects, useSettings } = await freshStores();
    useProjects.setState({ activeTaskId: 'active' });
    const setUnseenTaskIds = vi.fn();
    useSettings.setState({ notificationSound: 'default', setUnseenTaskIds } as never);
    const cleanup = useRuntime.getState().init();

    activityCb!({ x: { state: 'stopped' } }); // parked by the supervisor: counts as rested
    activityCb!({ x: { state: 'busy' } });
    vi.advanceTimersByTime(4000);
    activityCb!({ x: { state: 'stopped' } }); // idle-stop mid-flight is not "done"
    expect(playNotificationSound).not.toHaveBeenCalled();

    activityCb!({ x: { state: 'busy' } });
    vi.advanceTimersByTime(4000);
    activityCb!({ x: { state: 'idle' } });
    expect(playNotificationSound).toHaveBeenCalledWith('default');
    cleanup();
  });
});

describe('runtimeStore.init — supervisor sessions', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  let listCb: ((rows: unknown) => void) | null;
  beforeEach(() => {
    listCb = null;
    api = makeElectronApiMock();
    api.onSessionList = vi.fn((cb: (rows: unknown) => void) => {
      listCb = cb;
      return vi.fn();
    });
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('seeds from sessionList and follows pushed listings', async () => {
    const row = { id: 'abcd1234', cwd: '/p/a', kind: 'background', startedAt: 1 };
    api.sessionList = vi.fn(() => Promise.resolve({ success: true, data: [row] }));
    const { useRuntime } = await freshStores();
    const cleanup = useRuntime.getState().init();
    await Promise.resolve();
    expect(useRuntime.getState().supervisorSessions).toEqual([row]);
    listCb!([]);
    expect(useRuntime.getState().supervisorSessions).toEqual([]);
    cleanup();
  });

  it('adoptSession reloads the project tasks and returns the task', async () => {
    const adopted = task('t9', 'a', { jobId: 'abcd1234' });
    api.sessionAdopt = vi.fn(() => Promise.resolve({ success: true, data: adopted }));
    api.getTasks = vi.fn(() => Promise.resolve({ success: true, data: [adopted] }));
    const { useRuntime, useProjects } = await freshStores();
    useProjects.setState({ projects: [proj('a')] });
    const result = await useRuntime.getState().adoptSession('a', 'abcd1234');
    expect(result).toEqual(adopted);
    expect(api.sessionAdopt).toHaveBeenCalledWith({ projectId: 'a', jobId: 'abcd1234' });
    expect(useProjects.getState().tasksByProject.a).toEqual([adopted]);
  });
});

describe('runtimeStore.init — remote control', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  let rcCb: ((u: { ptyId: string; state: unknown }) => void) | null;
  beforeEach(() => {
    rcCb = null;
    api = makeElectronApiMock();
    api.onRemoteControlStateChanged = vi.fn(
      (cb: (u: { ptyId: string; state: unknown }) => void) => {
        rcCb = cb;
        return vi.fn();
      },
    );
    api.ptyRemoteControlGetAllStates = vi.fn(() => Promise.resolve({ success: true, data: {} }));
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('adds and removes remote-control states by ptyId', async () => {
    const { useRuntime } = await freshStores();
    const cleanup = useRuntime.getState().init();

    rcCb!({ ptyId: 'p', state: { foo: 1 } });
    expect(useRuntime.getState().remoteControlStates.p).toEqual({ foo: 1 });
    rcCb!({ ptyId: 'p', state: null });
    expect(useRuntime.getState().remoteControlStates.p).toBeUndefined();
    cleanup();
  });
});

describe('runtimeStore.init — token stats writeback', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  let tokenCb: ((u: { taskId: string; totalTokens: number; totalCostUsd: number }) => void) | null;
  beforeEach(() => {
    tokenCb = null;
    api = makeElectronApiMock();
    api.onTokenStatsUpdated = vi.fn(
      (cb: (u: { taskId: string; totalTokens: number; totalCostUsd: number }) => void) => {
        tokenCb = cb;
        return vi.fn();
      },
    );
    api.getGlobalTokenStats = vi.fn(() =>
      Promise.resolve({ success: true, data: { totalTokens: 0, totalCostUsd: 0, taskCount: 0 } }),
    );
    api.getProjectTokenStats = vi.fn(() =>
      Promise.resolve({ success: true, data: { totalTokens: 0, totalCostUsd: 0, taskCount: 0 } }),
    );
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('patches the matching task in projectsStore', async () => {
    const { useRuntime, useProjects } = await freshStores();
    useProjects.setState({ tasksByProject: { p1: [task('t1', 'p1'), task('t2', 'p1')] } });
    const cleanup = useRuntime.getState().init();

    tokenCb!({ taskId: 't2', totalTokens: 999, totalCostUsd: 1.5 });

    const t2 = useProjects.getState().tasksByProject.p1!.find((t) => t.id === 't2');
    expect(t2?.totalTokens).toBe(999);
    expect(t2?.totalCostUsd).toBe(1.5);
    cleanup();
  });
});

describe('runtimeStore.init — cleanup', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('unsubscribes everything on cleanup', async () => {
    const activityUnsub = vi.fn();
    const rcUnsub = vi.fn();
    const tokenUnsub = vi.fn();
    api.onPtyActivity = vi.fn(() => activityUnsub);
    api.onRemoteControlStateChanged = vi.fn(() => rcUnsub);
    api.onTokenStatsUpdated = vi.fn(() => tokenUnsub);

    const { useRuntime } = await freshStores();
    const cleanup = useRuntime.getState().init();
    await Promise.resolve();

    cleanup();
    expect(activityUnsub).toHaveBeenCalled();
    expect(rcUnsub).toHaveBeenCalled();
    expect(tokenUnsub).toHaveBeenCalled();
  });
});

describe('runtimeStore.init — auto-update', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  const status = (over: Record<string, unknown> = {}) => ({
    state: 'idle',
    availableVersion: null,
    releaseNotes: null,
    percent: null,
    lastCheckAt: null,
    checkStartedAt: null,
    lastError: null,
    initialized: true,
    ...over,
  });

  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('seeds the status on init so a pending update is visible at once', async () => {
    const ready = status({ state: 'ready', availableVersion: '0.16.1' });
    api.autoUpdateGetStatus = vi.fn(() => Promise.resolve({ success: true, data: ready }));

    const { useRuntime } = await freshStores();
    useRuntime.getState().init();
    await Promise.resolve();
    await Promise.resolve();

    expect(useRuntime.getState().updateStatus).toEqual(ready);
  });

  it('follows every pushed status and unsubscribes on cleanup', async () => {
    let push: ((s: unknown) => void) | null = null;
    const unsub = vi.fn();
    api.onAutoUpdateStatus = vi.fn((cb: (s: unknown) => void) => {
      push = cb;
      return unsub;
    });

    const { useRuntime } = await freshStores();
    const cleanup = useRuntime.getState().init();
    await Promise.resolve();

    push!(status({ state: 'downloading', percent: 40, availableVersion: '0.16.1' }));
    expect(useRuntime.getState().updateStatus?.state).toBe('downloading');
    expect(useRuntime.getState().updateStatus?.percent).toBe(40);

    push!(status({ state: 'ready', percent: 100, availableVersion: '0.16.1' }));
    expect(useRuntime.getState().updateStatus?.state).toBe('ready');

    cleanup();
    expect(unsub).toHaveBeenCalled();
  });

  // A check that no-ops (cooldown, or an update already in hand) emits nothing,
  // so the action must reconcile or the UI sticks on "Checking…".
  it('reconciles from getStatus after a check that emitted nothing', async () => {
    const found = status({ state: 'available', availableVersion: '0.16.1' });
    api.autoUpdateGetStatus = vi.fn(() => Promise.resolve({ success: true, data: found }));

    const { useRuntime } = await freshStores();
    await useRuntime.getState().checkForUpdates();

    expect(api.autoUpdateCheck).toHaveBeenCalled();
    expect(useRuntime.getState().updateStatus).toEqual(found);
  });

  it('surfaces a failed check instead of swallowing it', async () => {
    const { toast } = await import('sonner');
    api.autoUpdateCheck = vi.fn(() => Promise.resolve({ success: false, error: 'offline' }));

    const { useRuntime } = await freshStores();
    await useRuntime.getState().checkForUpdates();

    expect(toast.error).toHaveBeenCalledWith('offline');
  });

  it('surfaces a failed install instead of swallowing it', async () => {
    const { toast } = await import('sonner');
    api.autoUpdateQuitAndInstall = vi.fn(() =>
      Promise.resolve({ success: false, error: 'not ready' }),
    );

    const { useRuntime } = await freshStores();
    await useRuntime.getState().installUpdate();

    expect(toast.error).toHaveBeenCalledWith('not ready');
  });
});
