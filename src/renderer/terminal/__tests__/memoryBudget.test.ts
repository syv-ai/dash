import { describe, it, expect } from 'vitest';
import { estimateBytes, planScrollbackTrims, type BudgetedTerminal } from '../memoryBudget';

const MB = 1024 * 1024;

function term(id: string, lines: number, lastViewedAt: number, attached = false): BudgetedTerminal {
  return { id, lines, cols: 200, lastViewedAt, attached };
}

describe('estimateBytes', () => {
  // Measured with @xterm/headless: 100k lines at 200 cols held ~229MB of
  // ArrayBuffers + ~42MB JS heap — about 12 bytes per cell all in.
  it('costs a full 100k-line, 200-col buffer at roughly its measured size', () => {
    const bytes = estimateBytes({ lines: 100_000, cols: 200 });
    expect(bytes / MB).toBeGreaterThan(220);
    expect(bytes / MB).toBeLessThan(280);
  });
});

describe('planScrollbackTrims', () => {
  it('trims nothing while the total is under budget', () => {
    const terms = [term('a', 20_000, 1), term('b', 20_000, 2)];
    expect(planScrollbackTrims(terms, 1024 * MB, 10_000).size).toBe(0);
  });

  it('trims the least recently viewed terminal first', () => {
    // Three full panes ≈ 690MB against a 500MB budget: trimming the oldest
    // frees enough on its own.
    const terms = [term('new', 100_000, 3), term('old', 100_000, 1), term('mid', 100_000, 2)];
    const plan = planScrollbackTrims(terms, 500 * MB, 10_000);
    expect([...plan.keys()]).toEqual(['old']);
  });

  it('moves on to the next oldest once a terminal is at the floor', () => {
    const terms = [term('new', 100_000, 3), term('old', 100_000, 1), term('mid', 100_000, 2)];
    const plan = planScrollbackTrims(terms, 400 * MB, 10_000);
    expect(plan.get('old')).toBe(10_000);
    expect(plan.has('mid')).toBe(true);
    expect(plan.has('new')).toBe(false);
  });

  it('trims only as far as the budget needs', () => {
    const terms = [term('a', 100_000, 1), term('b', 100_000, 2)];
    const plan = planScrollbackTrims(terms, 400 * MB, 10_000);
    const kept = plan.get('a')!;
    expect(kept).toBeGreaterThan(10_000);
    expect(kept).toBeLessThan(100_000);
    const total =
      estimateBytes({ lines: kept, cols: 200 }) + estimateBytes({ lines: 100_000, cols: 200 });
    expect(total).toBeLessThanOrEqual(400 * MB);
  });

  it('never trims an attached (visible) terminal, even when it is the oldest', () => {
    const terms = [term('visible', 100_000, 1, true), term('hidden', 100_000, 2)];
    const plan = planScrollbackTrims(terms, 100 * MB, 10_000);
    expect(plan.has('visible')).toBe(false);
    expect(plan.get('hidden')).toBe(10_000);
  });

  it('never trims below the floor, and skips terminals already at it', () => {
    const terms = [term('small', 8_000, 1), term('big', 100_000, 2)];
    const plan = planScrollbackTrims(terms, 1 * MB, 10_000);
    expect(plan.has('small')).toBe(false);
    expect(plan.get('big')).toBe(10_000);
  });
});
