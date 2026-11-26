import { describe, expect, it } from 'vitest';
import { UsageLedger } from '../usageLedger';

describe('UsageLedger', () => {
  it('adds active minutes and keeps the peak of busy sessions for the day', () => {
    const l = new UsageLedger();
    l.addActiveMinute('2026-11-26');
    l.addActiveMinute('2026-11-26');
    expect(l.noteBusy(2, '2026-11-26')).toBe(true);
    expect(l.noteBusy(1, '2026-11-26')).toBe(false);
    expect(l.noteBusy(3, '2026-11-26')).toBe(true);
    expect(l.toJSON().current).toEqual({ date: '2026-11-26', activeMinutes: 2, peakBusy: 3 });
    expect(l.finished).toBeNull();
  });

  it('closes the day when the date moves on, and starts the next at zero', () => {
    const l = new UsageLedger();
    l.addActiveMinute('2026-11-26');
    l.noteBusy(4, '2026-11-26');
    l.addActiveMinute('2026-11-27');
    expect(l.finished).toEqual({ date: '2026-11-26', activeMinutes: 1, peakBusy: 4 });
    expect(l.toJSON().current).toEqual({ date: '2026-11-27', activeMinutes: 1, peakBusy: 0 });
  });

  it('survives a restart: a crash loses no minutes already counted', () => {
    const before = new UsageLedger();
    before.addActiveMinute('2026-11-26');
    before.noteBusy(2, '2026-11-26');
    const after = new UsageLedger(JSON.parse(JSON.stringify(before.toJSON())));
    after.rollTo('2026-11-27');
    expect(after.finished).toEqual({ date: '2026-11-26', activeMinutes: 1, peakBusy: 2 });
  });

  it('keeps a finished day until it is cleared; a later close replaces it', () => {
    const l = new UsageLedger();
    l.addActiveMinute('2026-11-24');
    l.rollTo('2026-11-25');
    l.rollTo('2026-11-25');
    expect(l.finished?.date).toBe('2026-11-24');
    l.addActiveMinute('2026-11-25');
    l.rollTo('2026-11-26');
    expect(l.finished?.date).toBe('2026-11-25');
    l.clearFinished();
    expect(l.finished).toBeNull();
  });

  it('reads a missing or malformed saved state as empty', () => {
    expect(new UsageLedger(undefined).toJSON()).toEqual({ current: null, finished: null });
    const l = new UsageLedger({ current: { date: 7 }, finished: 'x' } as never);
    expect(l.toJSON()).toEqual({ current: null, finished: null });
  });
});
