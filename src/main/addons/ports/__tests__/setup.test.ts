import { describe, it, expect } from 'vitest';
import { next, SETUP_TIMEOUT_MS, type Setup } from '../setup';

describe('ports setup', () => {
  it('start from idle creates the setup task', () => {
    expect(next(null, { type: 'start' })).toEqual({
      setup: { kind: 'creating' },
      effects: ['createSetupTask'],
    });
  });

  it('start retries after a failed create, but not while creating', () => {
    expect(next({ kind: 'create-failed', message: 'x' }, { type: 'start' }).effects).toEqual([
      'createSetupTask',
    ]);
    expect(next({ kind: 'creating' }, { type: 'start' }).effects).toEqual([]);
  });

  it('created and createFailed only move a task that is creating', () => {
    expect(next({ kind: 'creating' }, { type: 'created', setupTaskId: 's1' }).setup).toEqual({
      kind: 'started',
      setupTaskId: 's1',
    });
    expect(next({ kind: 'creating' }, { type: 'createFailed', message: 'boom' }).setup).toEqual({
      kind: 'create-failed',
      message: 'boom',
    });
    expect(next(null, { type: 'created', setupTaskId: 's1' }).setup).toBeNull();
  });

  it('the setup task starts waiting', () => {
    expect(next(null, { type: 'setupTaskBorn', now: 5 }).setup).toEqual({
      kind: 'waiting',
      since: 5,
    });
  });

  it('a valid config while waiting allocates and toasts', () => {
    expect(next({ kind: 'waiting', since: 0 }, { type: 'config', count: 3 })).toEqual({
      setup: { kind: 'allocated', count: 3 },
      effects: ['toastAllocated'],
    });
  });

  it('an invalid config keeps waiting and shows the errors; a later valid one still wins', () => {
    const erred = next({ kind: 'waiting', since: 0 }, { type: 'configError', errors: ['bad'] });
    expect(erred.setup).toEqual({ kind: 'waiting', since: 0, errors: ['bad'] });
    expect(next(erred.setup, { type: 'config', count: 1 }).setup).toEqual({
      kind: 'allocated',
      count: 1,
    });
  });

  it('config events outside waiting are ignored (e.g. a later edit in a configured task)', () => {
    expect(next(null, { type: 'config', count: 2 })).toEqual({ setup: null, effects: [] });
    const allocated: Setup = { kind: 'allocated', count: 1 };
    expect(next(allocated, { type: 'configError', errors: ['x'] }).setup).toBe(allocated);
  });

  it('times out after 30 minutes of waiting', () => {
    const waiting: Setup = { kind: 'waiting', since: 0 };
    expect(next(waiting, { type: 'tick', now: SETUP_TIMEOUT_MS }).setup).toBe(waiting);
    expect(next(waiting, { type: 'tick', now: SETUP_TIMEOUT_MS + 1 }).setup).toEqual({
      kind: 'timed-out',
    });
  });

  it('restart after allocation restarts sessions and clears the state', () => {
    expect(next({ kind: 'allocated', count: 2 }, { type: 'restart' })).toEqual({
      setup: null,
      effects: ['restartSessions'],
    });
    expect(next({ kind: 'waiting', since: 0 }, { type: 'restart' }).effects).toEqual([]);
  });

  it('dismiss clears finished states but not in-progress ones', () => {
    for (const s of [
      { kind: 'started', setupTaskId: 's' },
      { kind: 'create-failed', message: 'x' },
      { kind: 'allocated', count: 1 },
      { kind: 'timed-out' },
    ] as Setup[]) {
      expect(next(s, { type: 'dismiss' }).setup).toBeNull();
    }
    const creating: Setup = { kind: 'creating' };
    expect(next(creating, { type: 'dismiss' }).setup).toBe(creating);
  });
});
