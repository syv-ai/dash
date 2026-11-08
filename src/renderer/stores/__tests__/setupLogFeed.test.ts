import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { SetupLog, SetupRun } from '../../../shared/setupRuns';
import { followSetupLog } from '../setupLogFeed';

describe('followSetupLog', () => {
  let onChanged: (r: SetupRun) => void;
  let onOutput: (d: { worktreePath: string; chunk: string }) => void;
  let answer: (log: SetupLog | null) => void;
  let shown: string;
  let resets: number;
  let off: () => void;

  beforeEach(() => {
    const api = makeElectronApiMock({
      onWorktreeSetupChanged: vi.fn((cb: typeof onChanged) => {
        onChanged = cb;
        return () => {};
      }),
      onWorktreeSetupOutput: vi.fn((cb: typeof onOutput) => {
        onOutput = cb;
        return () => {};
      }),
    });
    api.worktreeSetupLog.mockImplementation(
      () => new Promise((resolve) => (answer = (data) => resolve({ success: true, data }))),
    );
    installWindow(api);
    shown = '';
    resets = 0;
    off = followSetupLog('/wt/a', {
      reset: (text, trimmed) => {
        resets++;
        shown = (trimmed ? '[trimmed]' : '') + text;
      },
      append: (chunk) => (shown += chunk),
    });
  });

  afterEach(() => {
    off();
    resetWindow();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));
  const running = (path = '/wt/a'): SetupRun => ({
    worktreePath: path,
    status: 'running',
    startedAt: 2,
    endedAt: null,
    error: null,
  });

  it('drops chunks that land before the snapshot, then appends live ones', async () => {
    onOutput({ worktreePath: '/wt/a', chunk: 'early ' });
    answer({ text: 'early ', trimmed: false });
    await flush();
    onOutput({ worktreePath: '/wt/a', chunk: 'late' });
    onOutput({ worktreePath: '/wt/b', chunk: 'other' });
    expect(shown).toBe('early late');
  });

  it('shows that older output was trimmed', async () => {
    answer({ text: 'tail', trimmed: true });
    await flush();
    expect(shown).toBe('[trimmed]tail');
  });

  it('starts over on a new run and ignores a snapshot that answers after it', async () => {
    onChanged(running());
    onOutput({ worktreePath: '/wt/a', chunk: 'fresh' });
    answer({ text: 'stale', trimmed: false });
    await flush();
    expect(shown).toBe('fresh');
    expect(resets).toBe(1);
    onChanged(running('/wt/b'));
    expect(resets).toBe(1);
  });

  it('stops after unsubscribing', async () => {
    off();
    answer({ text: 'x', trimmed: false });
    await flush();
    expect(resets).toBe(0);
  });
});
