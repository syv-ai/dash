import { describe, expect, it } from 'vitest';
import type { DiffComment, PrFile, PrReviewThread } from '../../../../shared/types';
import {
  DELETED_BLOB,
  checksSummary,
  fileRows,
  groupByPath,
  lineLabel,
  navStops,
  nextStop,
  nextUnviewed,
  replyDraftCounts,
  reviewComments,
  threadGroups,
  threadHeadline,
  threadPlace,
  trayNotes,
} from '../outline';

const file = (path: string, blob: string | null = `b-${path}`): PrFile => ({
  path,
  status: blob ? 'modified' : 'deleted',
  additions: 1,
  deletions: 0,
  blob,
});

const thread = (id: string, over: Partial<PrReviewThread> = {}): PrReviewThread => ({
  id,
  path: 'a.ts',
  line: 3,
  startLine: null,
  side: 'RIGHT',
  isOutdated: false,
  resolved: false,
  comments: [{ id: `${id}c`, author: 'ann', body: 'hi', createdAt: '', url: '' }],
  ...over,
});

const draft = (id: string, over: Partial<DiffComment> = {}): DiffComment => ({
  id,
  taskId: 't1',
  filePath: 'a.ts',
  startLine: 1,
  endLine: 1,
  text: id,
  sent: false,
  viewScope: 'pr:github:4',
  side: 'RIGHT',
  replyTo: null,
  author: 'user',
  kind: 'comment',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('fileRows', () => {
  it('orders by path and counts unresolved threads and the person’s comments', () => {
    const rows = fileRows(
      [file('b.ts'), file('a.ts')],
      [thread('1'), thread('2', { resolved: true }), thread('3', { path: 'b.ts' })],
      {},
      [draft('d1'), draft('d2', { kind: 'note' }), draft('d3', { replyTo: '1' })],
    );
    expect(rows.map((r) => [r.file.path, r.threads, r.drafts])).toEqual([
      ['a.ts', 1, 2],
      ['b.ts', 1, 0],
    ]);
  });

  it('counts a file viewed only while its mark names its head blob', () => {
    const rows = fileRows(
      [file('a.ts'), file('b.ts'), file('gone.ts', null)],
      [],
      {
        'a.ts': 'b-a.ts',
        'b.ts': 'old',
        'gone.ts': DELETED_BLOB,
      },
      [],
    );
    expect(rows.map((r) => r.viewed)).toEqual([true, false, true]);
  });
});

describe('nextUnviewed', () => {
  const rows = fileRows([file('a'), file('b'), file('c')], [], { b: 'b-b' }, []);

  it('takes the next unviewed file after the open one, wrapping', () => {
    expect(nextUnviewed(rows, 'a')).toBe('c');
    expect(nextUnviewed(rows, 'c')).toBe('a');
  });

  it('starts at the top with nothing open', () => {
    expect(nextUnviewed(rows, null)).toBe('a');
  });

  it('is null when every other file is viewed', () => {
    const one = fileRows([file('a'), file('b')], [], { b: 'b-b' }, []);
    expect(nextUnviewed(one, 'a')).toBeNull();
  });
});

describe('threadGroups', () => {
  it('splits open threads on lines from those off the code, and resolved ones', () => {
    const g = threadGroups([
      thread('r', { resolved: true }),
      thread('late', { line: 9 }),
      thread('early', { line: 2 }),
      thread('outdated', { line: null, isOutdated: true }),
      thread('left', { side: 'LEFT' }),
    ]);
    expect(g.unresolved.map((t) => t.id)).toEqual(['early', 'late']);
    expect(g.offCode.map((t) => t.id)).toEqual(['outdated', 'left']);
    expect(g.resolved.map((t) => t.id)).toEqual(['r']);
  });
});

describe('threadHeadline', () => {
  it('is the first non-blank line of the first comment', () => {
    const t = thread('1', {
      comments: [
        { id: 'c', author: 'a', body: '\n  Rename this\nbecause', createdAt: '', url: '' },
      ],
    });
    expect(threadHeadline(t)).toBe('Rename this');
    expect(threadHeadline(thread('2', { comments: [] }))).toBe('');
  });
});

describe('drafts and notes', () => {
  const byFile = {
    'b.ts': [draft('n1', { kind: 'note', viewScope: 'live', filePath: 'b.ts' })],
    'a.ts': [
      draft('c2', { startLine: 8, endLine: 9 }),
      draft('c1', { startLine: 2, endLine: 2 }),
      draft('other', { viewScope: 'pr:github:5' }),
      draft('n2', { kind: 'note', sent: true }),
    ],
  };

  it('lists the PR’s comments of its scope, grouped by file and line', () => {
    const groups = groupByPath(reviewComments(byFile, 'pr:github:4'));
    expect(groups.map(([p, l]) => [p, l.map((c) => c.id)])).toEqual([['a.ts', ['c1', 'c2']]]);
  });

  it('collects notes of every view, split by sent', () => {
    const { unsent, sent } = trayNotes(byFile);
    expect(unsent.map((c) => c.id)).toEqual(['n1']);
    expect(sent.map((c) => c.id)).toEqual(['n2']);
  });

  it('counts draft replies per thread', () => {
    expect(
      replyDraftCounts([draft('a', { replyTo: 'T' }), draft('b', { replyTo: 'T' }), draft('c')]),
    ).toEqual(new Map([['T', 2]]));
  });

  it('labels a line or a range', () => {
    expect(lineLabel({ startLine: 3, endLine: 3 })).toBe('L3');
    expect(lineLabel({ startLine: 3, endLine: 5 })).toBe('L3–5');
  });
});

describe('checksSummary', () => {
  const c = (state: 'passing' | 'failing' | 'pending' | 'skipped') => ({
    name: state,
    state,
    url: null,
  });
  it('counts every state, the ones that need a look first', () => {
    expect(
      checksSummary([c('passing'), c('skipped'), c('passing'), c('failing'), c('skipped')]),
    ).toBe('1 failing · 2 passing · 2 skipped');
    expect(checksSummary([c('passing'), c('skipped')])).toBe('1 passing · 1 skipped');
  });
  it('is null without checks', () => {
    expect(checksSummary([])).toBeNull();
  });
});

describe('next/previous thread or draft', () => {
  const stops = navStops(
    [
      thread('t1', { path: 'b.ts', line: 10 }),
      thread('t2', { path: 'a.ts', line: 3 }),
      thread('off', { path: 'a.ts', line: null }),
      thread('left', { path: 'a.ts', line: 5, side: 'LEFT' }),
    ],
    [
      draft('d1', { filePath: 'a.ts', startLine: 8 }),
      draft('r1', { filePath: 'a.ts', startLine: 1, replyTo: 't2' }),
    ],
  );

  it('lists threads on lines and drafts (not replies) by file, then line', () => {
    expect(stops.map((s) => s.id)).toEqual(['t2', 'd1', 't1']);
  });

  it('moves on in the file, then to the next file, wrapping round', () => {
    expect(nextStop(stops, { path: 'a.ts', line: 1 }, 1)?.id).toBe('t2');
    expect(nextStop(stops, { path: 'a.ts', line: 3 }, 1)?.id).toBe('d1');
    expect(nextStop(stops, { path: 'a.ts', line: 9 }, 1)?.id).toBe('t1');
    expect(nextStop(stops, { path: 'b.ts', line: 10 }, 1)?.id).toBe('t2');
    expect(nextStop(stops, { path: 'c.ts', line: 1 }, 1)?.id).toBe('t2');
  });

  it('moves back the same way', () => {
    expect(nextStop(stops, { path: 'b.ts', line: 10 }, -1)?.id).toBe('d1');
    expect(nextStop(stops, { path: 'a.ts', line: 8 }, -1)?.id).toBe('t2');
    expect(nextStop(stops, { path: 'a.ts', line: 3 }, -1)?.id).toBe('t1');
  });

  it('has nowhere to go without threads or drafts', () => {
    expect(nextStop([], { path: 'a.ts', line: 1 }, 1)).toBeNull();
  });
});

describe('threadPlace', () => {
  it("splits the file's name and line(s) from its folder", () => {
    expect(threadPlace(thread('t', { path: 'src/lib/a.ts', startLine: 2, line: 5 }))).toEqual({
      name: 'a.ts:2-5',
      dir: 'src/lib',
    });
    expect(threadPlace(thread('t', { path: 'a.ts', line: null, isOutdated: true }))).toEqual({
      name: 'a.ts (outdated)',
      dir: '',
    });
  });
});
