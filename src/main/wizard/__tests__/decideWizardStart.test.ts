import { describe, it, expect } from 'vitest';
import { decideWizardStart } from '../decideWizardStart';

describe('decideWizardStart', () => {
  it('starts when relevant, not dismissed, no engagement', () => {
    expect(decideWizardStart({ dismissed: false, relevant: true, engagement: 'none' })).toEqual({
      start: true,
    });
  });

  it('blocks with already-active when a side-car is live (even when forced)', () => {
    expect(decideWizardStart({ dismissed: false, relevant: true, engagement: 'live' })).toEqual({
      start: false,
      reason: 'already-active',
    });
    expect(
      decideWizardStart({ dismissed: false, relevant: true, engagement: 'live', force: true }),
    ).toEqual({ start: false, reason: 'already-active' });
  });

  it('blocks a suppressed (finished) engagement on the non-force path', () => {
    expect(
      decideWizardStart({ dismissed: false, relevant: true, engagement: 'suppressed' }),
    ).toEqual({ start: false, reason: 'already-active' });
  });

  it('force re-runs a suppressed (finished, not live) engagement', () => {
    expect(
      decideWizardStart({
        dismissed: false,
        relevant: false,
        engagement: 'suppressed',
        force: true,
      }),
    ).toEqual({ start: true });
  });

  it('blocks with dismissed when the feature was dismissed', () => {
    expect(decideWizardStart({ dismissed: true, relevant: true, engagement: 'none' })).toEqual({
      start: false,
      reason: 'dismissed',
    });
  });

  it('blocks with not-relevant when the wizard has nothing to offer', () => {
    expect(decideWizardStart({ dismissed: false, relevant: false, engagement: 'none' })).toEqual({
      start: false,
      reason: 'not-relevant',
    });
  });

  it('force bypasses the dismissed and not-relevant gates', () => {
    expect(
      decideWizardStart({ dismissed: true, relevant: false, engagement: 'none', force: true }),
    ).toEqual({ start: true });
  });
});
