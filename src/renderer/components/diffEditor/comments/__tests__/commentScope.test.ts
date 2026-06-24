import { describe, it, expect } from 'vitest';
import {
  commentCountsByScope,
  commentScope,
  commitShortHash,
  filterCommentsByScope,
  scopeLabel,
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
});
