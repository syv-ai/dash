import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isServedScratchpad,
  noteScratchpad,
  readTaskScratchpad,
  taskScratchpadDir,
} from '../ScratchpadService';

const { sent, tasks } = vi.hoisted(() => ({
  sent: [] as unknown[][],
  tasks: {} as Record<string, { path: string; sessionId: string | null }>,
}));
vi.mock('../../utils/broadcast', () => ({
  broadcast: (...args: unknown[]) => sent.push(args),
}));
vi.mock('../DatabaseService', () => ({
  DatabaseService: { getTask: (id: string) => tasks[id] },
}));

describe('ScratchpadService', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('derives the dir from the recorded session until a payload names one', () => {
    tasks.t1 = { path: '/r/wt', sessionId: 'abc' };
    if (process.platform !== 'win32') {
      expect(taskScratchpadDir('t1')).toMatch(/\/claude-\d+\/-r-wt\/abc\/scratchpad$/);
    }
    noteScratchpad('t1', {
      session_id: 'abc',
      scratchpad_dir: '/custom/claude-1/-r-wt/abc/scratchpad',
    });
    expect(taskScratchpadDir('t1')).toBe('/custom/claude-1/-r-wt/abc/scratchpad');
    expect(sent).toEqual([['agent:scratchpadChanged', { taskId: 't1' }]]);
  });

  it('tells the renderer only when the dir changes', () => {
    tasks.t2 = { path: '/r', sessionId: null };
    expect(taskScratchpadDir('t2')).toBeNull();
    const payload = { session_id: 's', scratchpad_dir: '/x/s/scratchpad' };
    noteScratchpad('t2', payload);
    noteScratchpad('t2', payload);
    noteScratchpad('t2', { session_id: 's', scratchpad_dir: 'not absolute' });
    expect(sent).toHaveLength(1);
  });

  it('lets the editor list a dir as plain files once it was served', async () => {
    tasks.t3 = { path: '/r', sessionId: null };
    noteScratchpad('t3', { session_id: 'q', scratchpad_dir: '/nowhere/q/scratchpad' });
    expect(isServedScratchpad('/nowhere/q/scratchpad')).toBe(false);
    expect(await readTaskScratchpad('t3')).toEqual({
      dir: '/nowhere/q/scratchpad',
      exists: false,
      listing: { files: [], dirs: [] },
    });
    expect(isServedScratchpad('/nowhere/q/scratchpad/')).toBe(true);
  });
});
