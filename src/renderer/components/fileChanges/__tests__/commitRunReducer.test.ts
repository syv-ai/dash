import { describe, it, expect } from 'vitest';
import { commitRunReducer, initialRunningState, type CommitRunEvent } from '../commitRunReducer';

const REQ = 'req-1';

function reduce(events: CommitRunEvent[]) {
  let state = initialRunningState(REQ);
  for (const e of events) state = commitRunReducer(state, e);
  return state;
}

describe('commitRunReducer', () => {
  it('starts in running with empty hooks', () => {
    const s = initialRunningState(REQ);
    expect(s.status).toBe('running');
    if (s.status === 'running') {
      expect(s.hooks).toEqual([]);
      expect(s.requestId).toBe(REQ);
    }
  });

  it('appends a hook on hookResult', () => {
    const s = reduce([{ type: 'hookResult', name: 'black', status: 'Passed' }]);
    if (s.status !== 'running') throw new Error('expected running');
    expect(s.hooks).toEqual([{ name: 'black', status: 'Passed', diagnostic: '' }]);
  });

  it('folds meta onto the current hook', () => {
    const s = reduce([
      { type: 'hookResult', name: 'black', status: 'Failed' },
      { type: 'hookMeta', key: 'id', value: 'black' },
      { type: 'hookMeta', key: 'exit', value: 1 },
      { type: 'hookMeta', key: 'modified', value: true },
    ]);
    if (s.status !== 'running') throw new Error('expected running');
    const h = s.hooks[0];
    expect(h.id).toBe('black');
    expect(h.exitCode).toBe(1);
    expect(h.modifiedFiles).toBe(true);
  });

  it('appends diagnostic lines to current hook', () => {
    const s = reduce([
      { type: 'hookResult', name: 'ruff', status: 'Failed' },
      { type: 'hookDiagnostic', text: 'src/foo.py:1:1: F401' },
      { type: 'hookDiagnostic', text: 'src/bar.py:2:1: F401' },
    ]);
    if (s.status !== 'running') throw new Error('expected running');
    expect(s.hooks[0].diagnostic).toBe('src/foo.py:1:1: F401\nsrc/bar.py:2:1: F401');
  });

  it('settles to success when close.exitCode is 0 and no failures', () => {
    const s = reduce([
      { type: 'hookResult', name: 'black', status: 'Passed' },
      { type: 'close', exitCode: 0, signal: null },
    ]);
    expect(s.status).toBe('success');
  });

  it('settles to cancelled when signal is non-null', () => {
    const s = reduce([
      { type: 'hookResult', name: 'black', status: 'Passed' },
      { type: 'close', exitCode: null, signal: 'SIGTERM' },
    ]);
    expect(s.status).toBe('cancelled');
  });

  it('settles to failed when exitCode is non-zero', () => {
    const s = reduce([
      { type: 'hookResult', name: 'ruff', status: 'Failed' },
      { type: 'close', exitCode: 1, signal: null },
    ]);
    expect(s.status).toBe('failed');
    if (s.status === 'failed') {
      expect(s.hooks).toHaveLength(1);
    }
  });

  it('collects raw output before any hookResult', () => {
    const s = reduce([
      { type: 'rawOutput', text: 'fatal: not a git repo' },
      { type: 'close', exitCode: 128, signal: null },
    ]);
    expect(s.status).toBe('failed');
    if (s.status === 'failed') {
      expect(s.raw).toBe('fatal: not a git repo');
      expect(s.hooks).toEqual([]);
    }
  });
});
