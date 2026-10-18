import { describe, it, expect } from 'vitest';
import { githubReviewFrom } from '../github';

const comment = (
  id: string,
  login: string | null,
  body = 'b',
  createdAt = '2026-10-17T10:00:00Z',
) => ({
  id,
  author: login === null ? null : { login },
  body,
  createdAt,
  url: `u/${id}`,
});
const at = { number: 4, base: 'B', head: 'H' };

describe('githubReviewFrom', () => {
  it('keeps every review thread, resolved or not, with its comments', () => {
    const pr = {
      reviewThreads: {
        nodes: [
          {
            id: 'T1',
            isResolved: false,
            isOutdated: false,
            path: 'src/a.ts',
            line: 12,
            startLine: 10,
            diffSide: 'RIGHT',
            comments: { nodes: [comment('C1', 'rev', 'Null here'), comment('C2', 'me', 'ok')] },
          },
          {
            id: 'T2',
            isResolved: true,
            isOutdated: false,
            path: 'src/b.ts',
            line: 3,
            diffSide: 'RIGHT',
            comments: { nodes: [comment('C3', 'rev')] },
          },
          {
            id: 'T3',
            isResolved: false,
            isOutdated: true,
            path: 'src/c.ts',
            line: null,
            startLine: null,
            diffSide: 'LEFT',
            comments: { nodes: [comment('C4', null)] },
          },
        ],
      },
    };
    const { threads } = githubReviewFrom(pr, at);
    expect(
      threads.map((t) => [t.id, t.resolved, t.side, t.line, t.startLine, t.isOutdated]),
    ).toEqual([
      ['T1', false, 'RIGHT', 12, 10, false],
      ['T2', true, 'RIGHT', 3, null, false],
      ['T3', false, 'LEFT', null, null, true],
    ]);
    expect(threads[0]!.comments[0]).toEqual({
      id: 'C1',
      author: 'rev',
      body: 'Null here',
      createdAt: '2026-10-17T10:00:00Z',
      url: 'u/C1',
    });
    // A deleted account reads as GitHub's "ghost".
    expect(threads[2]!.comments[0]!.author).toBe('ghost');
  });

  it('merges general comments and review summaries into the conversation, oldest first', () => {
    const pr = {
      comments: {
        nodes: [
          comment('IC2', 'ann', 'later', '2026-10-17T12:00:00Z'),
          comment('IC1', 'bo', 'first', '2026-10-17T09:00:00Z'),
        ],
      },
      reviews: {
        nodes: [
          {
            ...comment('R1', 'cy', 'Looks good overall', '2026-10-17T11:00:00Z'),
            state: 'APPROVED',
          },
          { ...comment('R2', 'cy', '', '2026-10-17T11:30:00Z'), state: 'COMMENTED' },
          { ...comment('R3', 'me', 'draft summary', '2026-10-17T11:45:00Z'), state: 'PENDING' },
        ],
      },
    };
    expect(githubReviewFrom(pr, at).conversation.map((c) => c.id)).toEqual(['IC1', 'R1', 'IC2']);
  });

  it('describes the PR and offers only "comment" on your own PR', () => {
    const base = { title: 'Fix it', url: 'https://x/pull/4' };
    const theirs = githubReviewFrom({ ...base, viewerDidAuthor: false }, at);
    expect(theirs).toMatchObject({
      provider: 'github',
      number: 4,
      title: 'Fix it',
      url: 'https://x/pull/4',
      base: 'B',
      head: 'H',
      viewerIsAuthor: false,
      verdicts: ['comment', 'approve', 'request_changes'],
    });
    expect(theirs.partial).toBeUndefined();
    expect(githubReviewFrom({ ...base, viewerDidAuthor: true }, at).verdicts).toEqual(['comment']);
  });

  it('flags a review with more threads than were loaded', () => {
    const pr = { reviewThreads: { pageInfo: { hasNextPage: true }, nodes: [] } };
    expect(githubReviewFrom(pr, at).partial).toBe(true);
  });

  it('tolerates junk', () => {
    expect(githubReviewFrom(null, at)).toMatchObject({ threads: [], conversation: [], title: '' });
    expect(
      githubReviewFrom({ reviewThreads: { nodes: [null, { isResolved: false }] } }, at).threads,
    ).toEqual([
      {
        id: '',
        path: '',
        line: null,
        startLine: null,
        side: 'RIGHT',
        isOutdated: false,
        resolved: false,
        comments: [],
      },
    ]);
  });
});
