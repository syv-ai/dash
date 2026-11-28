import { describe, expect, it } from 'vitest';
import type { DiffComment, PrFile, PrReviewThread } from '../../../../shared/types';
import {
  DELETED_BLOB,
  checksRollup,
  checksSummary,
  threadGroups,
  draftPlace,
  firstOpenThread,
  fileRows,
  groupByPath,
  lineLabel,
  navStops,
  nextStop,
  nextUnviewed,
  prFileChanges,
  reviewComments,
  reviewTally,
  threadHeadline,
  threadPlace,
  threadTally,
  threadRange,
  trayNotes,
  treeBadges,
  viewedPaths,
  type ThreadItem,
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
  comments: [
    {
      id: `${id}c`,
      author: 'ann',
      body: 'hi',
      createdAt: '',
      url: '',
      authorUrl: null,
      reactions: [],
    },
  ],
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
  commit: null,
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

  it('follows the Files tree: folders first, depth first', () => {
    const d = 'src/renderer/components';
    const tree = fileRows(
      [
        file(`${d}/ui/Modal.tsx`),
        file(`${d}/review/SubmitReview.tsx`),
        file(`${d}/diffEditor/EditorSidebar.tsx`),
        file(`${d}/review/finish/Footer.tsx`),
      ],
      [],
      {},
      [],
    );
    expect(tree.map((r) => r.file.path)).toEqual([
      `${d}/diffEditor/EditorSidebar.tsx`,
      `${d}/review/finish/Footer.tsx`,
      `${d}/review/SubmitReview.tsx`,
      `${d}/ui/Modal.tsx`,
    ]);
    expect(nextUnviewed(tree, `${d}/review/SubmitReview.tsx`)).toBe(`${d}/ui/Modal.tsx`);
    expect(nextUnviewed(tree, `${d}/review/finish/Footer.tsx`)).toBe(
      `${d}/review/SubmitReview.tsx`,
    );
  });
});

describe('threadGroups', () => {
  it('puts open threads and the person’s draft threads together, by file and line', () => {
    const g = threadGroups(
      [
        thread('r', { resolved: true }),
        thread('late', { line: 9 }),
        thread('early', { line: 2 }),
        thread('outdated', { line: null, isOutdated: true }),
        thread('other', { path: 'b.ts', line: 1 }),
      ],
      [draft('mine', { startLine: 5, endLine: 5 }), draft('top', { filePath: '0.ts' })],
    );
    const ids = (items: ThreadItem[]) =>
      items.map((i) => (i.kind === 'posted' ? i.thread.id : `draft:${i.draft.id}`));
    expect(ids(g.unresolved)).toEqual([
      'draft:top',
      'outdated',
      'early',
      'draft:mine',
      'late',
      'other',
    ]);
    expect(ids(g.resolved)).toEqual(['r']);
  });

  it('nests a draft reply under its thread, open or resolved', () => {
    const g = threadGroups(
      [thread('T'), thread('R', { resolved: true })],
      [draft('a', { replyTo: 'T' }), draft('b', { replyTo: 'R' }), draft('c', { replyTo: 'T' })],
    );
    const replies = (i: ThreadItem | undefined) =>
      i?.kind === 'posted' ? i.replies.map((c) => c.id) : null;
    expect(replies(g.unresolved[0])).toEqual(['a', 'c']);
    expect(replies(g.resolved[0])).toEqual(['b']);
    expect(g.unresolved).toHaveLength(1);
  });

  it('keeps a reply whose thread is gone as its own draft thread', () => {
    const g = threadGroups([], [draft('lost', { replyTo: 'gone' })]);
    expect(g.unresolved).toEqual([{ kind: 'draft', draft: draft('lost', { replyTo: 'gone' }) }]);
  });
});

describe('threadTally', () => {
  const two = thread('T', { comments: [...thread('a').comments, ...thread('b').comments] });

  it('counts replies after the first comment, drafts, and says resolved', () => {
    expect(threadTally(two, 0)).toBe('1 reply');
    expect(threadTally(two, 2)).toBe('1 reply · 2 drafts');
    expect(threadTally({ ...two, resolved: true }, 1)).toBe('1 reply · 1 draft · Resolved');
  });

  it('is empty for a lone open comment', () => {
    expect(threadTally(thread('T'), 0)).toBe('');
    const three = thread('T', { comments: [...two.comments, ...thread('c').comments] });
    expect(threadTally(three, 0)).toBe('2 replies');
  });
});

describe('threadHeadline', () => {
  it('is the first non-blank line of the first comment', () => {
    const t = thread('1', {
      comments: [
        {
          id: 'c',
          author: 'a',
          body: '\n  Rename this\nbecause',
          createdAt: '',
          url: '',
          authorUrl: null,
          reactions: [],
        },
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

  it('places a draft as a thread row does', () => {
    expect(draftPlace({ filePath: 'src/a.ts', startLine: 3, endLine: 3 })).toEqual({
      name: 'a.ts:3',
      dir: 'src',
    });
    expect(draftPlace({ filePath: 'a.ts', startLine: 3, endLine: 5 })).toEqual({
      name: 'a.ts:3-5',
      dir: '',
    });
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

describe('checksRollup', () => {
  const c = (state: 'passing' | 'failing' | 'pending' | 'skipped') => ({ state });
  it('fails on any failure, then runs while any runs, else passes', () => {
    expect(checksRollup([c('passing'), c('pending'), c('failing')])).toBe('failing');
    expect(checksRollup([c('passing'), c('pending'), c('skipped')])).toBe('pending');
    expect(checksRollup([c('passing'), c('skipped')])).toBe('passing');
    expect(checksRollup([c('skipped')])).toBe('passing');
  });
  it('is null without checks', () => {
    expect(checksRollup([])).toBeNull();
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

  it('crosses files in the Files tree’s order: a folder’s files after its subfolders', () => {
    const tree = navStops(
      [thread('root', { path: 'z.ts', line: 1 }), thread('deep', { path: 'src/a/b.ts', line: 2 })],
      [draft('mid', { filePath: 'src/z.ts', startLine: 1 })],
    );
    expect(tree.map((s) => s.id)).toEqual(['deep', 'mid', 'root']);
    expect(nextStop(tree, { path: 'src/a/b.ts', line: 2 }, 1)?.id).toBe('mid');
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

describe('the Changes tab', () => {
  const rows = fileRows(
    [file('a.ts'), file('b.ts'), file('c.ts')],
    [thread('1'), thread('2', { path: 'c.ts', resolved: true })],
    { 'b.ts': 'b-b.ts' },
    [draft('d1', { filePath: 'b.ts' })],
  );

  it('badges files with open threads or draft comments, none else', () => {
    expect([...treeBadges(rows)]).toEqual([
      ['a.ts', { threads: 1, comments: 0 }],
      ['b.ts', { threads: 0, comments: 1 }],
    ]);
  });

  it('knows which files are viewed', () => {
    expect([...viewedPaths(rows)]).toEqual(['b.ts']);
  });

  it('lists the PR files as tree changes, a rename keeping its old path', () => {
    expect(
      prFileChanges([
        { path: 'n.ts', status: 'renamed', oldPath: 'o.ts', additions: 1, deletions: 2, blob: 'x' },
        file('a.ts'),
      ]),
    ).toEqual([
      {
        path: 'n.ts',
        status: 'renamed',
        oldPath: 'o.ts',
        staged: false,
        additions: 1,
        deletions: 2,
      },
      { path: 'a.ts', status: 'modified', staged: false, additions: 1, deletions: 0 },
    ]);
  });
});

describe('reviewTally', () => {
  it('counts Unresolved’s threads and every unsent note of the task', () => {
    const byFile = {
      'a.ts': [
        draft('n1', { kind: 'note' }),
        draft('n2', { kind: 'note', sent: true }),
        draft('n3', { kind: 'note', viewScope: 'live' }),
        draft('c1'),
      ],
    };
    expect(
      reviewTally(
        [thread('1'), thread('2', { line: null }), thread('3', { resolved: true })],
        [draft('c1'), draft('r1', { replyTo: '1' }), draft('r3', { replyTo: '3' })],
        byFile,
      ),
      // Threads 1 and 2 and the new draft c1; the replies sit in their threads.
    ).toEqual({ threads: 3, notes: 2 });
  });

  it('counts a reply whose thread is gone as its own draft thread, as Unresolved shows it', () => {
    expect(reviewTally([], [draft('r', { replyTo: 'gone' })], {})).toEqual({
      threads: 1,
      notes: 0,
    });
  });
});

describe('firstOpenThread', () => {
  it('takes the first open thread on the code by file, then line', () => {
    const first = firstOpenThread([
      thread('late', { path: 'b.ts', line: 1 }),
      thread('done', { path: 'a.ts', line: 1, resolved: true }),
      thread('off', { path: 'a.ts', line: null }),
      thread('left', { path: 'a.ts', line: 2, side: 'LEFT' }),
      thread('here', { path: 'a.ts', line: 9 }),
    ]);
    expect(first?.id).toBe('here');
  });

  it('is null without an open thread on the code', () => {
    expect(firstOpenThread([thread('off', { line: null })])).toBeNull();
  });
});

describe('threadRange', () => {
  it('selects the thread’s lines from its first', () => {
    expect(threadRange({ ...thread('1'), line: 7, startLine: 5 })).toEqual({
      startLineNumber: 5,
      startColumn: 1,
      endLineNumber: 7,
      endColumn: 1,
    });
    expect(threadRange({ ...thread('1'), line: 7 })).toMatchObject({ startLineNumber: 7 });
  });
});
