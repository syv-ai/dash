import { describe, expect, it } from 'vitest';
import { headMovedPast, onPrHeadBranch, unpushedLine } from '../unpushed';

describe('onPrHeadBranch', () => {
  it("holds for the branch's own PR, whatever the branch reads", () => {
    expect(onPrHeadBranch('own', 'feat/x', 'feat/x')).toBe(true);
    expect(onPrHeadBranch('own', 'feat/x', null)).toBe(true);
  });

  it('holds for a picked PR only when its head is the branch checked out', () => {
    expect(onPrHeadBranch('stored', 'feat/x', 'feat/x')).toBe(true);
    expect(onPrHeadBranch('stored', 'feat/x', 'feat/y')).toBe(false);
    expect(onPrHeadBranch('stored', 'feat/x', null)).toBe(false);
  });
});

describe('unpushedLine', () => {
  it('counts the commits, singular and plural', () => {
    expect(unpushedLine(1)).toBe("1 local commit isn't in the PR yet — push to include it.");
    expect(unpushedLine(3)).toBe("3 local commits aren't in the PR yet — push to include them.");
  });
});

describe('headMovedPast', () => {
  it('holds only when both heads are known and differ', () => {
    expect(headMovedPast('b', 'a')).toBe(true);
    expect(headMovedPast('a', 'a')).toBe(false);
    expect(headMovedPast(undefined, 'a')).toBe(false);
    expect(headMovedPast('b', null)).toBe(false);
  });
});
