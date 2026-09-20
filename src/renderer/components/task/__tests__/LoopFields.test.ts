import { describe, it, expect } from 'vitest';
import { buildLoopConfig, defaultLoopDraft, loopDraftValid, type LoopDraft } from '../LoopFields';

const draft = (over: Partial<LoopDraft> = {}): LoopDraft => ({ ...defaultLoopDraft(), ...over });

describe('loopDraftValid', () => {
  it('requires a non-empty goal', () => {
    expect(loopDraftValid(defaultLoopDraft())).toBe(false);
    expect(loopDraftValid(draft({ goal: '   ' }))).toBe(false);
    expect(loopDraftValid(draft({ goal: 'ship it' }))).toBe(true);
  });
});

describe('buildLoopConfig', () => {
  it('ralph: keeps stopPredicate + maxIterations, nulls cadence/completion', () => {
    const cfg = buildLoopConfig(
      draft({
        goal: ' refactor ',
        policy: 'ralph',
        stopPredicate: ' pnpm test ',
        maxIterations: '5',
      }),
    );
    expect(cfg).toMatchObject({
      policy: 'ralph',
      goal: 'refactor',
      stopPredicate: 'pnpm test',
      maxIterations: 5,
      cadenceMs: null,
      completionPromise: null,
    });
  });

  it('cadence: keeps interval, nulls stopPredicate + maxIterations', () => {
    const cfg = buildLoopConfig(draft({ goal: 'watch', policy: 'cadence', cadenceMs: '300000' }));
    expect(cfg).toMatchObject({
      policy: 'cadence',
      cadenceMs: 300000,
      stopPredicate: null,
      maxIterations: null,
    });
  });

  it('count: keeps maxIterations + completion phrase', () => {
    const cfg = buildLoopConfig(
      draft({ goal: 'sweep', policy: 'count', maxIterations: '3', completionPromise: 'ALL DONE' }),
    );
    expect(cfg).toMatchObject({ policy: 'count', maxIterations: 3, completionPromise: 'ALL DONE' });
  });

  it('drops invalid/zero numbers to null and blank strings to null', () => {
    const cfg = buildLoopConfig(
      draft({
        goal: 'g',
        policy: 'ralph',
        stopPredicate: '  ',
        maxIterations: '0',
        tokenBudget: 'abc',
      }),
    );
    expect(cfg.stopPredicate).toBeNull();
    expect(cfg.maxIterations).toBeNull();
    expect(cfg.tokenBudget).toBeNull();
  });

  it('splits constraints into trimmed non-empty lines (omitted when none)', () => {
    expect(
      buildLoopConfig(draft({ goal: 'g', constraints: '  never touch auth  \n\n  run tests \n' }))
        .constraints,
    ).toEqual(['never touch auth', 'run tests']);
    expect(buildLoopConfig(draft({ goal: 'g', constraints: '   ' })).constraints).toBeUndefined();
  });

  it('parses a positive token budget', () => {
    expect(buildLoopConfig(draft({ goal: 'g', tokenBudget: '500000' })).tokenBudget).toBe(500000);
  });
});
