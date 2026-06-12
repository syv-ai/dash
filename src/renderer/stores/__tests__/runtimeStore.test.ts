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
    expect(useRuntime.getState().projectTokenStats.p1.totalTokens).toBe(60);
    expect(useRuntime.getState().projectTokenStats.p2.totalTokens).toBe(40);
  });
});

describe('runtimeStore RTK actions', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('enableRtk optimistically flips the installed status then calls IPC', async () => {
    api.rtkSetEnabled = vi.fn(() => Promise.resolve({ success: true, data: {} }));
    const { useRuntime } = await freshStores();
    useRuntime.setState({ rtkStatus: { installed: true, enabled: false } as never });

    await useRuntime.getState().enableRtk(true);

    expect((useRuntime.getState().rtkStatus as { enabled: boolean }).enabled).toBe(true);
    expect(api.rtkSetEnabled).toHaveBeenCalledWith(true);
  });

  it('enableRtk re-fetches status when the IPC call fails', async () => {
    api.rtkSetEnabled = vi.fn(() => Promise.resolve({ success: false, error: 'no' }));
    api.rtkGetStatus = vi.fn(() =>
      Promise.resolve({ success: true, data: { installed: true, enabled: false } }),
    );
    const { useRuntime } = await freshStores();
    useRuntime.setState({ rtkStatus: { installed: true, enabled: false } as never });

    await useRuntime.getState().enableRtk(true);

    expect(api.rtkGetStatus).toHaveBeenCalled();
  });

  it('downloadRtk sets downloading then records an error on failure', async () => {
    api.rtkDownload = vi.fn(() => Promise.resolve({ success: false, error: 'boom' }));
    const { useRuntime } = await freshStores();
    await useRuntime.getState().downloadRtk();
    expect(useRuntime.getState().rtkDownloadProgress).toEqual({ phase: 'error', error: 'boom' });
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

    const t2 = useProjects.getState().tasksByProject.p1.find((t) => t.id === 't2');
    expect(t2?.totalTokens).toBe(999);
    expect(t2?.totalCostUsd).toBe(1.5);
    cleanup();
  });
});

describe('runtimeStore.init — rtk + cleanup', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    api.rtkGetStatus = vi.fn(() =>
      Promise.resolve({ success: true, data: { installed: true, enabled: true } }),
    );
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('loads rtk status on init and unsubscribes everything on cleanup', async () => {
    const activityUnsub = vi.fn();
    const rcUnsub = vi.fn();
    const tokenUnsub = vi.fn();
    const rtkUnsub = vi.fn();
    api.onPtyActivity = vi.fn(() => activityUnsub);
    api.onRemoteControlStateChanged = vi.fn(() => rcUnsub);
    api.onTokenStatsUpdated = vi.fn(() => tokenUnsub);
    api.onRtkDownloadProgress = vi.fn(() => rtkUnsub);

    const { useRuntime } = await freshStores();
    const cleanup = useRuntime.getState().init();
    await Promise.resolve();

    expect(useRuntime.getState().rtkStatus).toEqual({ installed: true, enabled: true });

    cleanup();
    expect(activityUnsub).toHaveBeenCalled();
    expect(rcUnsub).toHaveBeenCalled();
    expect(tokenUnsub).toHaveBeenCalled();
    expect(rtkUnsub).toHaveBeenCalled();
  });
});
