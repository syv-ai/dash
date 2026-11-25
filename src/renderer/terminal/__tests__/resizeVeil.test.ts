import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizeVeil } from '../resizeVeil';

describe('ResizeVeil', () => {
  let shown: boolean[];
  let veil: ResizeVeil;
  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
    veil = new ResizeVeil(
      (s) => shown.push(s),
      () => Date.now(),
    );
  });
  afterEach(() => {
    veil.dispose();
    vi.useRealTimers();
  });

  it('shows as the grid starts to change and lifts 150 ms after the fit', () => {
    veil.report('resize');
    expect(shown).toEqual([true]);
    vi.advanceTimersByTime(250);
    veil.report('fit');
    vi.advanceTimersByTime(149);
    expect(shown).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual([true, false]);
  });

  it('stays while the box keeps resizing (a panel ease), waiting for its fit', () => {
    veil.report('resize');
    for (let i = 0; i < 28; i++) {
      vi.advanceTimersByTime(10);
      veil.report('resize');
    }
    vi.advanceTimersByTime(250);
    expect(shown).toEqual([true]);
    veil.report('fit');
    vi.advanceTimersByTime(150);
    expect(shown).toEqual([true, false]);
  });

  it('waits for the redraw that follows the fit to go quiet', () => {
    veil.report('resize');
    vi.advanceTimersByTime(250);
    veil.report('fit');
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(20);
      veil.report('output');
    }
    expect(shown).toEqual([true]);
    vi.advanceTimersByTime(99);
    expect(shown).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual([true, false]);
  });

  it('lifts 600 ms after the last fit however busy the output', () => {
    veil.report('resize');
    vi.advanceTimersByTime(250);
    veil.report('fit');
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(20);
      veil.report('output');
    }
    expect(shown).toEqual([true, false]);
  });

  it('lifts on the cap when no fit comes (the box hid)', () => {
    veil.report('resize');
    vi.advanceTimersByTime(600);
    expect(shown).toEqual([true, false]);
  });

  it('ignores fits and output while lifted', () => {
    veil.report('fit');
    veil.report('output');
    vi.advanceTimersByTime(1000);
    expect(shown).toEqual([]);
  });
});
