import { describe, it, expect } from 'vitest';
import { parseCommitLog } from '../editorIpc';

// `git log --numstat --format=COMMIT_LOG_FORMAT`: \x1e opens a commit, \x1f
// splits its fields, \x1d closes them, then a blank line and its numstat rows.
const commit = (hash: string, body: string, ...numstat: string[]) =>
  `\x1e${hash}\x1f${hash.slice(0, 3)}\x1fAda\x1f1700000000\x1fSubject ${hash}\x1f${body}\x1d\n\n${numstat.join('\n')}\n`;

describe('parseCommitLog', () => {
  it('reads each commit with its lines summed across its files', () => {
    const out =
      commit('abc123', '', '5\t2\tsrc/a.ts', '3\t0\tsrc/b.ts') + commit('def456', '', '1\t1\tx.ts');
    expect(parseCommitLog(out)).toEqual([
      {
        hash: 'abc123',
        shortHash: 'abc',
        authorName: 'Ada',
        authorDate: 1700000000,
        subject: 'Subject abc123',
        body: '',
        additions: 8,
        deletions: 2,
      },
      expect.objectContaining({ hash: 'def456', additions: 1, deletions: 1 }),
    ]);
  });

  it('keeps a multi-line body whole, trimmed', () => {
    const [c] = parseCommitLog(commit('abc123', 'Line one\n\n5\t2\tnot a stat\n', '1\t0\ta.ts'));
    expect(c).toMatchObject({ body: 'Line one\n\n5\t2\tnot a stat', additions: 1, deletions: 0 });
  });

  it('counts binary files (- / -) as zero', () => {
    const [c] = parseCommitLog(commit('abc123', '', '-\t-\timg.png', '4\t1\tsrc/a.ts'));
    expect(c).toMatchObject({ additions: 4, deletions: 1 });
  });

  it('leaves a commit without numstat (a merge) at 0/0', () => {
    const out = commit('merge1', '') + commit('abc123', '', '2\t0\ta.ts');
    expect(parseCommitLog(out).map((c) => [c.hash, c.additions, c.deletions])).toEqual([
      ['merge1', 0, 0],
      ['abc123', 2, 0],
    ]);
  });

  it('is empty for empty output', () => {
    expect(parseCommitLog('')).toEqual([]);
  });
});
