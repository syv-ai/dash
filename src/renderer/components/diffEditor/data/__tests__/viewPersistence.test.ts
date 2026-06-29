import { describe, it, expect } from 'vitest';
import { parseStoredView } from '../viewPersistence';
import type { EditorView } from '../../types';

describe('parseStoredView', () => {
  it('round-trips a working view (HEAD)', () => {
    const v: EditorView = { kind: 'working', ref: 'HEAD' };
    expect(parseStoredView(JSON.stringify(v))).toEqual(v);
  });

  it('round-trips a working view (index)', () => {
    const v: EditorView = { kind: 'working', ref: 'index' };
    expect(parseStoredView(JSON.stringify(v))).toEqual(v);
  });

  it('round-trips a concrete commit view', () => {
    const v: EditorView = { kind: 'commit', hash: 'abc1234' };
    expect(parseStoredView(JSON.stringify(v))).toEqual(v);
  });

  it('round-trips a branch view', () => {
    const v: EditorView = { kind: 'branch', base: 'origin/main' };
    expect(parseStoredView(JSON.stringify(v))).toEqual(v);
  });

  it('rejects the unresolved HEAD commit sentinel', () => {
    expect(parseStoredView(JSON.stringify({ kind: 'commit', hash: 'HEAD' }))).toBeNull();
  });

  it('returns null for null / empty input', () => {
    expect(parseStoredView(null)).toBeNull();
    expect(parseStoredView('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseStoredView('{not json')).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(parseStoredView(JSON.stringify({ kind: 'tag', name: 'v1' }))).toBeNull();
  });

  it('rejects a working view with a bad ref', () => {
    expect(parseStoredView(JSON.stringify({ kind: 'working', ref: 'STAGE' }))).toBeNull();
  });

  it('rejects a commit view with an empty/missing hash', () => {
    expect(parseStoredView(JSON.stringify({ kind: 'commit', hash: '' }))).toBeNull();
    expect(parseStoredView(JSON.stringify({ kind: 'commit' }))).toBeNull();
  });

  it('rejects a branch view with an empty/missing base', () => {
    expect(parseStoredView(JSON.stringify({ kind: 'branch', base: '' }))).toBeNull();
    expect(parseStoredView(JSON.stringify({ kind: 'branch' }))).toBeNull();
  });

  it('rejects non-object JSON', () => {
    expect(parseStoredView('42')).toBeNull();
    expect(parseStoredView('"working"')).toBeNull();
    expect(parseStoredView('null')).toBeNull();
  });
});
