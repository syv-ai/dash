import { describe, it, expect } from 'vitest';
import type { RateLimits } from '../../../../shared/types';
import { mergeRateLimits } from '../../../lib/rateLimits';
import { formatTtr } from '../../../utils/format';
import { levelCells, limitCell } from '../UsageSection';

const rateLimits: RateLimits = {
  fiveHour: { usedPercentage: 35, resetsAt: 0 },
  sevenDay: { usedPercentage: 59, resetsAt: 0 },
};
const contextUsage = { used: 40_000, total: 200_000, percentage: 20 };

const keys = (over: Partial<Parameters<typeof levelCells>[0]> = {}) =>
  levelCells({
    contextUsage,
    rateLimits,
    showSession: true,
    showLimits: true,
    now: 0,
    ...over,
  }).map((c) => [c.key, c.pct]);

describe('levelCells', () => {
  it("shows the session's context, then the limits", () => {
    expect(keys()).toEqual([
      ['session', 20],
      ['fiveHour', 35],
      ['sevenDay', 59],
    ]);
  });

  it('keeps the session before its first reply, with no figure', () => {
    expect(keys({ contextUsage: undefined })[0]).toEqual(['session', null]);
  });

  it('leaves out what the settings hide, and the limits before the account reports them', () => {
    expect(keys({ showSession: false }).map(([k]) => k)).toEqual(['fiveHour', 'sevenDay']);
    expect(keys({ showLimits: false })).toEqual([['session', 20]]);
    expect(keys({ rateLimits: undefined })).toEqual([['session', 20]]);
  });

  it('reads 0% for a window that has ended with nothing since (R16)', () => {
    // A dormant session: its 5-hour window passed its reset, so Claude Code
    // drops `five_hour` from the status line (and Dash drops an expired one
    // too) while the weekly window still runs.
    const now = 1_800_000_000_000;
    const merged = mergeRateLimits(
      {
        idle: {
          contextUsage: { used: 0, total: 0, percentage: 0 },
          rateLimits: {
            fiveHour: { usedPercentage: 42, resetsAt: now / 1000 - 60 },
            sevenDay: { usedPercentage: 59, resetsAt: now / 1000 + 3600 },
          },
          updatedAt: now - 6 * 3600_000,
        },
      },
      now,
    );
    expect(keys({ rateLimits: merged, now })).toEqual([
      ['session', 20],
      ['fiveHour', 0],
      ['sevenDay', 59],
    ]);
  });
});

describe('limitCell', () => {
  it('rounds a running window, with its time to reset', () => {
    const cell = limitCell('fiveHour', { usedPercentage: 34.6, resetsAt: 3600 }, 0);
    expect([cell.pct, cell.caption]).toEqual([35, formatTtr(3600_000)]);
  });

  it('reads a window that is not running as 0%, with no reset time', () => {
    const cell = limitCell('sevenDay', undefined, 0);
    expect([cell.pct, cell.caption]).toEqual([0, undefined]);
    expect(cell.tooltip.rows).toEqual([{ label: 'Used', value: '0%' }]);
  });
});
