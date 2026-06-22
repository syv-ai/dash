import { describe, it, expect } from 'vitest';
import { resolveHeadSentinel, pickFirstChangedFile } from '../viewData';
import type { EditorView, CommitSummary } from '../../types';
import type { FileChange } from '../../../../../shared/types';

const commit = (hash: string): CommitSummary => ({
  hash,
  shortHash: hash.slice(0, 7),
  subject: 's',
  body: '',
  authorName: 'a',
  authorDate: 0,
});
const fc = (path: string): FileChange => ({
  path,
  status: 'modified',
  staged: false,
  additions: 0,
  deletions: 0,
});

describe('resolveHeadSentinel', () => {
  it('swaps a {commit, HEAD} view to the latest concrete hash', () => {
    const view: EditorView = { kind: 'commit', hash: 'HEAD' };
    const next = resolveHeadSentinel(view, [commit('abc123'), commit('def456')]);
    expect(next).toEqual({ kind: 'commit', hash: 'abc123' });
  });
  it('returns the same view when not the HEAD sentinel', () => {
    const view: EditorView = { kind: 'commit', hash: 'abc123' };
    expect(resolveHeadSentinel(view, [commit('abc123')])).toBe(view);
  });
  it('returns the same view for non-commit kinds', () => {
    const view: EditorView = { kind: 'working', ref: 'HEAD' };
    expect(resolveHeadSentinel(view, [commit('abc123')])).toBe(view);
  });
  it('returns the same view when commits are empty', () => {
    const view: EditorView = { kind: 'commit', hash: 'HEAD' };
    expect(resolveHeadSentinel(view, [])).toBe(view);
  });
});

describe('pickFirstChangedFile', () => {
  it('returns first changed file path for the active view kind', () => {
    expect(pickFirstChangedFile([fc('a.ts'), fc('b.ts')])).toBe('a.ts');
  });
  it('returns null when there are no changed files', () => {
    expect(pickFirstChangedFile([])).toBeNull();
  });
});
