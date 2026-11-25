import { describe, it, expect } from 'vitest';
import type { PrReviewComment, PrReviewThread } from '../../../../../shared/types';
import { filterMentions, insertMention, mentionAt, mentionCandidates } from '../mentions';

const comment = (author: string): PrReviewComment => ({
  id: author,
  author,
  authorUrl: null,
  body: '',
  createdAt: '',
  url: '',
  reactions: [],
});
const thread = (...authors: string[]): PrReviewThread => ({
  id: authors.join(),
  path: 'a.ts',
  line: 1,
  startLine: null,
  side: 'RIGHT',
  isOutdated: false,
  resolved: false,
  comments: authors.map(comment),
});

describe('mentionCandidates', () => {
  it('lists the author, reviewers, assignees, then commenters, each once', () => {
    expect(
      mentionCandidates({
        author: 'bo',
        reviewers: [{ name: 'ann', url: null, state: 'approved' }],
        assignees: ['cy', 'bo'],
        threads: [thread('di', 'bo'), thread('ghost')],
        conversation: [comment('ed'), comment('ann')],
      }),
    ).toEqual(['bo', 'ann', 'cy', 'di', 'ed']);
  });

  it('leaves out placeholder authors', () => {
    expect(
      mentionCandidates({
        author: 'Unknown',
        reviewers: [],
        assignees: [],
        threads: [thread('ghost', 'Ann Reviewer')],
        conversation: [],
      }),
    ).toEqual(['Ann Reviewer']);
  });
});

describe('mentionAt', () => {
  it('finds the @ the caret is typing after', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('hi @an', 6)).toEqual({ start: 3, query: 'an' });
    expect(mentionAt('(@bo-x.y', 8)).toEqual({ start: 1, query: 'bo-x.y' });
  });

  it('reads only up to the caret', () => {
    expect(mentionAt('hi @annie there', 6)).toEqual({ start: 3, query: 'an' });
  });

  it('is not one inside a word, or after a space', () => {
    expect(mentionAt('me@host', 7)).toBeNull();
    expect(mentionAt('@ann ', 5)).toBeNull();
    expect(mentionAt('no at', 5)).toBeNull();
  });
});

describe('filterMentions', () => {
  const people = ['bo', 'annie', 'joanna', 'Ann Reviewer', 'cy'];

  it('puts names starting with the query first, then those containing it', () => {
    expect(filterMentions(people, 'an')).toEqual(['annie', 'Ann Reviewer', 'joanna']);
  });

  it('lists everyone for an empty query, up to the limit', () => {
    expect(filterMentions(people, '')).toEqual(people);
    expect(filterMentions(people, '', 2)).toEqual(['bo', 'annie']);
  });

  it('is empty when nothing matches', () => {
    expect(filterMentions(people, 'zz')).toEqual([]);
  });
});

describe('insertMention', () => {
  it('replaces the typed part with the name and a space, caret after', () => {
    expect(insertMention('hi @an', { start: 3, query: 'an' }, 6, 'annie')).toEqual({
      text: 'hi @annie ',
      caret: 10,
    });
  });

  it('keeps the text after the caret, without doubling its space', () => {
    expect(insertMention('@a see this', { start: 0, query: 'a' }, 2, 'ann')).toEqual({
      text: '@ann see this',
      caret: 5,
    });
  });
});
