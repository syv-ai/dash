import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { SetupRun } from '../../../shared/setupRuns';

vi.mock('../../terminal/SessionRegistry', () => ({
  sessionRegistry: { dispose: vi.fn(), disposeByPrefix: vi.fn(), restartAllForTask: vi.fn() },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

import { toast } from 'sonner';
import { useSetup } from '../setupStore';

const run = (worktreePath: string, over: Partial<SetupRun> = {}): SetupRun => ({
  worktreePath,
  status: 'running',
  startedAt: 1,
  endedAt: null,
  error: null,
  ...over,
});

describe('setupStore', () => {
  let onChanged: (r: SetupRun) => void;
  let onOutput: (d: { worktreePath: string; chunk: string }) => void;
  let api: ReturnType<typeof makeElectronApiMock>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    api = makeElectronApiMock({
      onWorktreeSetupChanged: vi.fn((cb: typeof onChanged) => {
        onChanged = cb;
        return () => {};
      }),
      onWorktreeSetupOutput: vi.fn((cb: typeof onOutput) => {
        onOutput = cb;
        return () => {};
      }),
    });
    api.worktreeSetupList.mockResolvedValue({
      success: true,
      data: [run('/wt/a', { status: 'succeeded', endedAt: 2 })],
    });
    api.worktreeSetupLog.mockResolvedValue({
      success: true,
      data: { text: 'so far\n', trimmed: false },
    });
    installWindow(api);
    useSetup.setState({ runs: {}, viewPath: null, viewLog: null });
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

  it('tracks a run from running to failed and toasts once with a view action', () => {
    onChanged(run('/wt/b'));
    expect(useSetup.getState().runs['/wt/b']?.status).toBe('running');
    onChanged(run('/wt/b', { status: 'failed', error: 'boom', endedAt: 2 }));
    expect(useSetup.getState().runs['/wt/b']?.status).toBe('failed');
    expect(toast.error).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(toast.error).mock.calls[0]![1] as {
      description: string;
      action: { label: string; onClick: () => void };
    };
    expect(opts.description).toBe('boom');
    expect(opts.action.label).toBe('View output');
    opts.action.onClick();
    expect(useSetup.getState().viewPath).toBe('/wt/b');
  });

  it('appends output only for the open view', async () => {
    onOutput({ worktreePath: '/wt/c', chunk: 'ignored' });
    await useSetup.getState().openLog('/wt/c');
    expect(useSetup.getState().viewLog?.text).toBe('so far\n');
    onOutput({ worktreePath: '/wt/c', chunk: 'more\n' });
    onOutput({ worktreePath: '/wt/other', chunk: 'nope' });
    expect(useSetup.getState().viewLog?.text).toBe('so far\nmore\n');
  });

  it('clears the open log when a new run starts', async () => {
    await useSetup.getState().openLog('/wt/d');
    onChanged(run('/wt/d', { startedAt: 5 }));
    expect(useSetup.getState().viewLog).toEqual({ text: '', trimmed: false });
  });

  it('rerun opens the output, or toasts when main refuses', async () => {
    await useSetup.getState().rerun({ id: 't1', path: '/wt/e' });
    expect(api.worktreeSetupRerun).toHaveBeenCalledWith('t1');
    expect(useSetup.getState().viewPath).toBe('/wt/e');

    useSetup.getState().closeLog();
    api.worktreeSetupRerun.mockResolvedValueOnce({ success: false, error: 'already running' });
    await useSetup.getState().rerun({ id: 't1', path: '/wt/e' });
    expect(toast.error).toHaveBeenCalledWith('already running');
    expect(useSetup.getState().viewPath).toBeNull();
  });
});
