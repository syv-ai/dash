import { describe, it, expect } from 'vitest';
import { parseBlameIncremental, UNCOMMITTED_SHA } from './blameParser';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// Groups deliberately out of final-line order, and commit A repeats later with
// its metadata omitted (as --incremental does) to exercise the per-sha cache.
const FIXTURE = [
  `${A} 1 1 2`,
  'author Alice',
  'author-mail <alice@example.com>',
  'author-time 1700000000',
  'author-tz +0000',
  'committer Alice',
  'committer-mail <alice@example.com>',
  'committer-time 1700000000',
  'committer-tz +0000',
  'summary First commit',
  'filename foo.ts',
  `${A} 5 5 1`, // repeat of commit A, metadata omitted — must resolve from cache
  `previous ${B} foo.ts`,
  'filename foo.ts',
  `${B} 3 3 1`,
  'author Bob',
  'author-mail <bob@example.com>',
  'author-time 1700001000',
  'author-tz +0000',
  'summary Second commit',
  'filename foo.ts',
  `${UNCOMMITTED_SHA} 4 4 1`,
  'author Not Committed Yet',
  'author-mail <not.committed.yet>',
  'author-time 1700002000',
  'author-tz +0000',
  'summary Version of foo.ts',
  'filename foo.ts',
  '',
].join('\n');

describe('parseBlameIncremental', () => {
  it('returns one entry per line in ascending order', () => {
    const lines = parseBlameIncremental(FIXTURE);
    expect(lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5]);
  });

  it('maps a multi-line group to its commit metadata', () => {
    const lines = parseBlameIncremental(FIXTURE);
    expect(lines[0]).toMatchObject({
      line: 1,
      sha: A,
      shortSha: 'aaaaaaa',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorTime: 1700000000,
      summary: 'First commit',
      uncommitted: false,
    });
    expect(lines[1]).toMatchObject({ line: 2, sha: A, author: 'Alice' });
  });

  it('reuses cached metadata for a repeated commit with omitted metadata', () => {
    const lines = parseBlameIncremental(FIXTURE);
    expect(lines[4]).toMatchObject({
      line: 5,
      sha: A,
      author: 'Alice',
      summary: 'First commit',
      uncommitted: false,
    });
  });

  it('flags the all-zeros SHA as uncommitted', () => {
    const lines = parseBlameIncremental(FIXTURE);
    expect(lines[3]).toMatchObject({
      line: 4,
      sha: UNCOMMITTED_SHA,
      uncommitted: true,
    });
  });

  it('returns [] for empty output', () => {
    expect(parseBlameIncremental('')).toEqual([]);
  });
});
