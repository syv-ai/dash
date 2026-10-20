import { describe, it, expect } from 'vitest';
import {
  commentCountsByScope,
  commentScope,
  commitShortHash,
  filterCommentsByScope,
  groupByFile,
  scopeLabel,
  withoutPrComments,
} from '../commentScope';

describe('commentScope', () => {
  it('maps working and branch views to the shared "live" scope', () => {
    expect(commentScope({ kind: 'working', ref: 'HEAD' })).toBe('live');
    expect(commentScope({ kind: 'working', ref: 'index' })).toBe('live');
    expect(commentScope({ kind: 'branch', base: 'main' })).toBe('live');
    expect(commentScope({ kind: 'branch', base: 'origin/main' })).toBe('live');
  });

  it('scopes a commit view to its hash', () => {
    expect(commentScope({ kind: 'commit', hash: 'abc123' })).toBe('commit:abc123');
  });

  it('scopes a PR view to its provider and number', () => {
    const view = { kind: 'pr', provider: 'ado', number: 7, base: 'b', head: 'h' } as const;
    expect(commentScope(view)).toBe('pr:ado:7');
    expect(scopeLabel('pr:github:812')).toBe('PR #812');
  });
});

describe('filterCommentsByScope', () => {
  const c = (id: string, viewScope: string) => ({ id, viewScope });

  it('keeps only matching-scope comments and drops emptied files', () => {
    const byFile = {
      'a.ts': [c('1', 'live'), c('2', 'commit:abc')],
      'b.ts': [c('3', 'commit:abc')],
      'c.ts': [c('4', 'live')],
    };
    expect(filterCommentsByScope(byFile, 'live')).toEqual({
      'a.ts': [c('1', 'live')],
      'c.ts': [c('4', 'live')],
    });
  });

  it('returns an empty map when nothing matches', () => {
    expect(filterCommentsByScope({ 'a.ts': [c('1', 'live')] }, 'commit:xyz')).toEqual({});
  });
});

describe('scopeLabel + commitShortHash', () => {
  it('labels the live scope as Working tree', () => {
    expect(scopeLabel('live')).toBe('Working tree');
    expect(commitShortHash('live')).toBeNull();
  });

  it('labels a commit scope with its short hash', () => {
    expect(scopeLabel('commit:abcdef1234567890')).toBe('Commit abcdef1');
    expect(commitShortHash('commit:abcdef1234567890')).toBe('abcdef1');
  });
});

describe('commentCountsByScope', () => {
  it('tallies comments per scope across files', () => {
    const byFile = {
      'a.ts': [
        { id: '1', viewScope: 'live' },
        { id: '2', viewScope: 'commit:abc' },
      ],
      'b.ts': [
        { id: '3', viewScope: 'live' },
        { id: '4', viewScope: 'live' },
      ],
    };
    const counts = commentCountsByScope(byFile);
    expect(counts.get('live')).toBe(3);
    expect(counts.get('commit:abc')).toBe(1);
  });

  it('excludes already-sent comments from the per-scope tallies', () => {
    const byFile = {
      'a.ts': [
        { id: '1', viewScope: 'live', sent: false },
        { id: '2', viewScope: 'live', sent: true },
        { id: '3', viewScope: 'commit:abc', sent: true },
      ],
      'b.ts': [{ id: '4', viewScope: 'live', sent: false }],
    };
    const counts = commentCountsByScope(byFile);
    expect(counts.get('live')).toBe(2);
    // Every commit-scoped comment was sent → scope drops out of the map.
    expect(counts.get('commit:abc')).toBeUndefined();
  });

  it('keeps counting a PR comment sent to the agent: it still has to be submitted', () => {
    const counts = commentCountsByScope({
      'a.ts': [
        { id: '1', viewScope: 'pr:github:4', sent: true, kind: 'comment' as const },
        { id: '2', viewScope: 'pr:github:4', sent: true, kind: 'note' as const },
      ],
    });
    expect(counts.get('pr:github:4')).toBe(1);
  });
});

describe('withoutPrComments', () => {
  it("keeps notes, a PR view's too, and drops PR review comments", () => {
    const c = (id: string, viewScope: string, kind: 'note' | 'comment' = 'note') => ({
      id,
      viewScope,
      kind,
    });
    expect(
      withoutPrComments({
        'a.ts': [c('1', 'live'), c('2', 'pr:github:4', 'comment'), c('3', 'pr:github:4')],
        'b.ts': [c('4', 'pr:ado:7', 'comment')],
      }),
    ).toEqual({ 'a.ts': [c('1', 'live'), c('3', 'pr:github:4')] });
  });
});

describe('groupByFile', () => {
  const at = (id: string, filePath: string) => ({ id, filePath });

  it("groups by path in order, keeping each file's own order", () => {
    expect(groupByFile([at('1', 'b.ts'), at('2', 'a.ts'), at('3', 'b.ts')])).toEqual([
      ['a.ts', [at('2', 'a.ts')]],
      ['b.ts', [at('1', 'b.ts'), at('3', 'b.ts')]],
    ]);
  });

  it('puts the given file first', () => {
    const groups = groupByFile([at('1', 'a.ts'), at('2', 'c.ts'), at('3', 'b.ts')], 'c.ts');
    expect(groups.map(([path]) => path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });
});
