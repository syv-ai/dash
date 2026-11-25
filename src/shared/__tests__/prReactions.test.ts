import { describe, it, expect } from 'vitest';
import { GITHUB_REACTIONS, reactionChoices, toggleReaction } from '../prReactions';
import type { PrReaction } from '../types';

const r = (content: PrReaction['content'], count: number, viewerReacted = false): PrReaction => ({
  content,
  count,
  viewerReacted,
});

describe('reactionChoices', () => {
  it("offers GitHub's eight and ADO's like", () => {
    expect(reactionChoices('github')).toEqual(GITHUB_REACTIONS);
    expect(GITHUB_REACTIONS).toHaveLength(8);
    expect(reactionChoices('ado')).toEqual(['LIKE']);
  });
});

describe('toggleReaction', () => {
  it("adds the viewer's to a reaction others gave", () => {
    expect(toggleReaction([r('HEART', 2)], 'HEART', true)).toEqual([r('HEART', 3, true)]);
  });

  it("takes the viewer's back, dropping a reaction no one gives any more", () => {
    expect(toggleReaction([r('HEART', 2, true)], 'HEART', false)).toEqual([r('HEART', 1)]);
    expect(toggleReaction([r('HEART', 1, true)], 'HEART', false)).toEqual([]);
  });

  it("puts a new reaction in the forge's order", () => {
    expect(toggleReaction([r('THUMBS_UP', 1), r('EYES', 1)], 'HOORAY', true)).toEqual([
      r('THUMBS_UP', 1),
      r('HOORAY', 1, true),
      r('EYES', 1),
    ]);
  });

  it('changes nothing when it already holds', () => {
    const list = [r('ROCKET', 1, true)];
    expect(toggleReaction(list, 'ROCKET', true)).toEqual(list);
    expect(toggleReaction(list, 'EYES', false)).toEqual(list);
  });

  it('undoes itself', () => {
    const list = [r('THUMBS_UP', 2), r('LAUGH', 1, true)];
    expect(toggleReaction(toggleReaction(list, 'THUMBS_UP', true), 'THUMBS_UP', false)).toEqual(
      list,
    );
  });
});
