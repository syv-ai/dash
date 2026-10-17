import { describe, it, expect } from 'vitest';
import { unresolvedThreadsFrom } from '../prReview';

const comment = (id: string, login: string | null, body = 'b') => ({
  id,
  author: login === null ? null : { login },
  body,
  createdAt: '2026-10-17T10:00:00Z',
  url: `u/${id}`,
});

describe('unresolvedThreadsFrom', () => {
  it('keeps unresolved threads, with their comments, from the GraphQL pullRequest node', () => {
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
    expect(unresolvedThreadsFrom(pr)).toEqual([
      {
        id: 'T1',
        path: 'src/a.ts',
        line: 12,
        startLine: 10,
        side: 'RIGHT',
        isOutdated: false,
        comments: [
          {
            id: 'C1',
            author: 'rev',
            body: 'Null here',
            createdAt: '2026-10-17T10:00:00Z',
            url: 'u/C1',
          },
          { id: 'C2', author: 'me', body: 'ok', createdAt: '2026-10-17T10:00:00Z', url: 'u/C2' },
        ],
      },
      {
        id: 'T3',
        path: 'src/c.ts',
        line: null,
        startLine: null,
        side: 'LEFT',
        isOutdated: true,
        comments: [
          { id: 'C4', author: 'ghost', body: 'b', createdAt: '2026-10-17T10:00:00Z', url: 'u/C4' },
        ],
      },
    ]);
  });

  it('tolerates junk', () => {
    expect(unresolvedThreadsFrom(null)).toEqual([]);
    expect(
      unresolvedThreadsFrom({ reviewThreads: { nodes: [null, { isResolved: false }] } }),
    ).toEqual([
      {
        id: '',
        path: '',
        line: null,
        startLine: null,
        side: 'RIGHT',
        isOutdated: false,
        comments: [],
      },
    ]);
  });
});
