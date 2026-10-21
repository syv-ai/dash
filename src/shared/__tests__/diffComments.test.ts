import { describe, it, expect } from 'vitest';
import {
  canPromote,
  clearedByClearNotes,
  clearedBySent,
  isPrDraft,
  isPrunable,
  isSubmittable,
  kindFor,
  needsAttention,
} from '../diffComments';
import type { DiffCommentKind } from '../types';

const PR = 'pr:github:4';

// Every kind × scope × sent → what each action may do. A comment asked for
// outside a PR scope is stored as a note (kindFor), so it rows as one.
// attention: counted as needing attention · clearSent: Clear sent takes it ·
// clearNotes: Clear notes on its scope takes it · submit: Submit posts it ·
// promote: can become a PR comment · agent: the control API reaches it ·
// prune: deleted when its file is gone.
// prettier-ignore
const table: [DiffCommentKind, string, boolean, Record<string, boolean>][] = [
  ['note', 'live', false, { attention: true, clearSent: false, clearNotes: true, submit: false, promote: false, agent: false, prune: true }],
  ['note', 'live', true, { attention: false, clearSent: true, clearNotes: true, submit: false, promote: false, agent: false, prune: true }],
  ['note', 'commit:abc', false, { attention: true, clearSent: false, clearNotes: true, submit: false, promote: false, agent: false, prune: true }],
  ['note', 'commit:abc', true, { attention: false, clearSent: true, clearNotes: true, submit: false, promote: false, agent: false, prune: true }],
  ['note', PR, false, { attention: true, clearSent: false, clearNotes: true, submit: false, promote: true, agent: true, prune: false }],
  ['note', PR, true, { attention: false, clearSent: true, clearNotes: true, submit: false, promote: true, agent: true, prune: false }],
  ['comment', PR, false, { attention: true, clearSent: false, clearNotes: false, submit: true, promote: false, agent: true, prune: false }],
  ['comment', PR, true, { attention: true, clearSent: false, clearNotes: false, submit: true, promote: false, agent: true, prune: false }],
  ['comment', 'live', false, { attention: true, clearSent: false, clearNotes: true, submit: false, promote: false, agent: false, prune: true }],
  ['comment', 'live', true, { attention: false, clearSent: true, clearNotes: true, submit: false, promote: false, agent: false, prune: true }],
];

describe('comment rules', () => {
  it.each(table)('%s in %s, sent %s', (asked, viewScope, sent, want) => {
    const c = { kind: kindFor(viewScope, asked), viewScope, sent, filePath: 'gone.ts' };
    expect({
      attention: needsAttention(c),
      clearSent: clearedBySent(c),
      clearNotes: clearedByClearNotes(c, viewScope),
      submit: isSubmittable(c),
      promote: canPromote(c),
      agent: isPrDraft(c),
      prune: isPrunable(c, new Set()),
    }).toEqual(want);
  });

  it('limits Clear sent and Clear notes to the scope asked for', () => {
    const c = { kind: 'note' as const, viewScope: 'live', sent: true };
    expect(clearedBySent(c, 'commit:abc')).toBe(false);
    expect(clearedBySent(c, 'live')).toBe(true);
    expect(clearedByClearNotes(c, 'commit:abc')).toBe(false);
  });

  it('prunes only a file that is gone', () => {
    expect(isPrunable({ viewScope: 'live', filePath: 'a.ts' }, new Set(['a.ts']))).toBe(false);
  });
});
