import { describe, it, expect } from 'vitest';
import type { RateLimits } from '../../../../shared/types';
import { levelCells } from '../UsageSection';

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
});
