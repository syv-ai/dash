import { describe, it, expect } from 'vitest';
import { parseCommitNumstatLog } from '../editorIpc';

// `git log --numstat --format=%x1f%H` emits a \x1f-prefixed hash line per
// commit, followed by `<adds>\t<dels>\t<path>` numstat rows.
const U = '\x1f';

describe('parseCommitNumstatLog', () => {
  it('sums additions/deletions per commit across its files', () => {
    const out = [`${U}abc123`, '5\t2\tsrc/a.ts', '3\t0\tsrc/b.ts', `${U}def456`, '1\t1\tx.ts'].join(
      '\n',
    );
    const map = parseCommitNumstatLog(out);
    expect(map.get('abc123')).toEqual({ additions: 8, deletions: 2 });
    expect(map.get('def456')).toEqual({ additions: 1, deletions: 1 });
  });

  it('treats binary files (- / -) as zero', () => {
    const out = [`${U}abc123`, '-\t-\timg.png', '4\t1\tsrc/a.ts'].join('\n');
    expect(parseCommitNumstatLog(out)).toEqual(
      new Map([['abc123', { additions: 4, deletions: 1 }]]),
    );
  });

  it('records a commit with no numstat (e.g. merge) as 0/0', () => {
    const out = [`${U}merge1`, `${U}abc123`, '2\t0\ta.ts'].join('\n');
    const map = parseCommitNumstatLog(out);
    expect(map.get('merge1')).toEqual({ additions: 0, deletions: 0 });
    expect(map.get('abc123')).toEqual({ additions: 2, deletions: 0 });
  });

  it('tolerates blank lines between commit blocks', () => {
    const out = [`${U}abc123`, '', '5\t2\ta.ts', ''].join('\n');
    expect(parseCommitNumstatLog(out).get('abc123')).toEqual({ additions: 5, deletions: 2 });
  });

  it('returns an empty map for empty output', () => {
    expect(parseCommitNumstatLog('')).toEqual(new Map());
  });

  it('ignores numstat rows with no preceding commit header', () => {
    expect(parseCommitNumstatLog('5\t2\ta.ts')).toEqual(new Map());
  });
});
