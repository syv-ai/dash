import { describe, it, expect } from 'vitest';
import { commentCountsByScope, commentScope, commitShortHash, scopeLabel } from '../commentScope';

describe('commentScope', () => {
  it('maps working views to the shared "live" scope', () => {
    expect(commentScope({ kind: 'working', ref: 'HEAD' })).toBe('live');
    expect(commentScope({ kind: 'working', ref: 'index' })).toBe('live');
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
