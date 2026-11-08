import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { SetupRun } from '../../../shared/setupRuns';
import type { Task } from '../../../shared/types';

vi.mock('../../terminal/SessionRegistry', () => ({
  sessionRegistry: { dispose: vi.fn(), disposeByPrefix: vi.fn(), restartAllForTask: vi.fn() },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

import { toast } from 'sonner';
import { useSetup } from '../setupStore';
import { useProjects } from '../projectsStore';

const run = (worktreePath: string, over: Partial<SetupRun> = {}): SetupRun => ({
  worktreePath,
  status: 'running',
  startedAt: 1,
  endedAt: null,
  error: null,
  ...over,
});

const task = (id: string, projectId: string, path: string): Task =>
  ({ id, projectId, name: `task ${id}`, path, useWorktree: true, archivedAt: null }) as Task;

describe('setupStore', () => {
  let onChanged: (r: SetupRun) => void;
  let onForgotten: (d: { worktreePath: string }) => void;
  let api: ReturnType<typeof makeElectronApiMock>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    api = makeElectronApiMock({
      onWorktreeSetupChanged: vi.fn((cb: typeof onChanged) => {
        onChanged = cb;
        return () => {};
      }),
      onWorktreeSetupForgotten: vi.fn((cb: typeof onForgotten) => {
        onForgotten = cb;
        return () => {};
      }),
    });
    api.worktreeSetupList.mockResolvedValue({
      success: true,
      data: [run('/wt/a', { status: 'succeeded', endedAt: 2 })],
    });
    installWindow(api);
    useProjects.setState({
      activeProjectId: 'p1',
      activeTaskId: 't1',
      tasksByProject: { p1: [task('t1', 'p1', '/wt/one')], p2: [task('t2', 'p2', '/wt/two')] },
    });
    useSetup.setState({ runs: {}, setupTabRequest: null });
    cleanup = useSetup.getState().init();
  });

  afterEach(() => {
    cleanup();
    resetWindow();
  });

  it('loads the runs main already has', async () => {
    await Promise.resolve();
    await Promise.resolve();
    expect(useSetup.getState().runs['/wt/a']?.status).toBe('succeeded');
  });

  it('tracks a run to failed and toasts once, with an action that shows the Setup tab', () => {
    onChanged(run('/wt/two'));
    expect(useSetup.getState().runs['/wt/two']?.status).toBe('running');
    onChanged(run('/wt/two', { status: 'failed', error: 'boom', endedAt: 2 }));
    expect(useSetup.getState().runs['/wt/two']?.status).toBe('failed');
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, opts] = vi.mocked(toast.error).mock.calls[0]! as [
      string,
      { description: string; action: { label: string; onClick: () => void } },
    ];
    expect(title).toBe('Setup failed for task t2');
    expect(opts.description).toBe('boom');
    expect(opts.action.label).toBe('View output');
    opts.action.onClick();
    expect(useSetup.getState().setupTabRequest?.worktreePath).toBe('/wt/two');
  });

  it('showSetup selects the owning task, across projects, and makes a new request each time', () => {
    useSetup.getState().showSetup('/wt/two');
    expect(useProjects.getState().activeProjectId).toBe('p2');
    expect(useProjects.getState().activeTaskId).toBe('t2');
    const first = useSetup.getState().setupTabRequest!;
    useSetup.getState().showSetup('/wt/two');
    expect(useSetup.getState().setupTabRequest!.seq).toBe(first.seq + 1);
    useSetup.getState().clearSetupTabRequest();
    expect(useSetup.getState().setupTabRequest).toBeNull();
  });

  it('drops a forgotten run and its pending tab request', () => {
    onChanged(run('/wt/one'));
    useSetup.getState().showSetup('/wt/one');
    onForgotten({ worktreePath: '/wt/one' });
    expect(useSetup.getState().runs['/wt/one']).toBeUndefined();
    expect(useSetup.getState().setupTabRequest).toBeNull();
  });

  it('rerun shows the Setup tab, or toasts when main refuses', async () => {
    await useSetup.getState().rerun({ id: 't1', path: '/wt/one' });
    expect(api.worktreeSetupRerun).toHaveBeenCalledWith('t1');
    expect(useSetup.getState().setupTabRequest?.worktreePath).toBe('/wt/one');

    useSetup.getState().clearSetupTabRequest();
    api.worktreeSetupRerun.mockResolvedValueOnce({ success: false, error: 'already running' });
    await useSetup.getState().rerun({ id: 't1', path: '/wt/one' });
    expect(toast.error).toHaveBeenCalledWith('already running');
    expect(useSetup.getState().setupTabRequest).toBeNull();
  });
});
