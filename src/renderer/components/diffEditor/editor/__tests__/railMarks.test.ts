import { describe, expect, it } from 'vitest';
import type { PrReviewThread } from '../../../../../shared/types';
import { railChanges, railMarks, type RailGeometry } from '../railMarks';

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
      id: `${id}-c`,
      author: 'ana',
      body: 'Rename this\nplease',
      createdAt: '',
      url: '',
      authorUrl: null,
      reactions: [],
    },
  ],
  ...over,
});

/** 10px lines, no view zones. */
const geometry = (over: Partial<RailGeometry> = {}): RailGeometry => ({
  topFor: (line) => (line - 1) * 10,
  lineHeight: 10,
  contentHeight: 1000,
  railHeight: 500,
  ...over,
});

describe('railMarks', () => {
  it('scales a long file into the rail by its content height', () => {
    const [m] = railMarks([thread('t', { line: 50 })], [], geometry());
    // Line 50 is 490–500px of 1000.
    expect(m!.at).toBeCloseTo(0.49);
    expect(m!.size).toBeCloseTo(0.01);
  });

  it('keeps a short file beside its lines', () => {
    const [m] = railMarks([thread('t', { line: 5 })], [], geometry({ contentHeight: 100 }));
    // Line 5 is 40–50px of a 500px rail.
    expect(m!.at).toBeCloseTo(0.08);
    expect(m!.size).toBeCloseTo(0.02);
  });

  it('places by the editor geometry, so view zones above push marks down', () => {
    const zoned = geometry({ topFor: (line) => (line - 1) * 10 + (line > 2 ? 200 : 0) });
    const [m] = railMarks([thread('t', { line: 3 })], [], zoned);
    expect(m!.at).toBeCloseTo(0.22);
  });

  it('spans a multi-line thread or draft over its lines', () => {
    const [t, c] = railMarks(
      [thread('t', { startLine: 10, line: 19 })],
      [{ id: 'c', kind: 'comment', startLine: 30, endLine: 34, text: '' }],
      geometry(),
    );
    // Lines 10–19 are 90–190px, 30–34 are 290–340px, of 1000.
    expect(t).toMatchObject({ line: 19, at: 0.09 });
    expect(t!.size).toBeCloseTo(0.1);
    expect(c).toMatchObject({ line: 30, at: 0.29 });
    expect(c!.size).toBeCloseTo(0.05);
  });

  it('kinds threads, drafts and notes; skips threads off the code', () => {
    const marks = railMarks(
      [thread('open'), thread('done', { resolved: true }), thread('off', { line: null })],
      [
        { id: 'n', kind: 'note', startLine: 1, endLine: 1, text: 'Check this' },
        { id: 'c', kind: 'comment', startLine: 2, endLine: 2, text: 'Typo' },
      ],
      geometry(),
    );
    expect(marks.map((m) => [m.id, m.kind])).toEqual([
      ['done', 'resolved'],
      ['open', 'thread'],
      ['n', 'note'],
      ['c', 'comment'],
    ]);
  });

  it('paints your own over threads, each kind by line', () => {
    const marks = railMarks(
      [thread('late', { line: 9 }), thread('early', { line: 2 })],
      [{ id: 'c', kind: 'comment', startLine: 1, endLine: 1, text: '' }],
      geometry(),
    );
    expect(marks.map((m) => m.id)).toEqual(['early', 'late', 'c']);
  });

  it('previews one line with where and who', () => {
    const marks = railMarks(
      [thread('t', { startLine: 1 })],
      [
        { id: 'n', kind: 'note', startLine: 7, endLine: 7, text: '\n  Check the guard \nmore' },
        { id: 'c', kind: 'comment', startLine: 8, endLine: 8, text: '' },
      ],
      geometry(),
    );
    expect(marks.map((m) => m.preview)).toEqual([
      'L3 · @ana: Rename this',
      'L7 · Note to agent: Check the guard',
      'L8 · Comment: (no text)',
    ]);
  });

  it('cuts a long preview', () => {
    const [m] = railMarks(
      [],
      [{ id: 'n', kind: 'note', startLine: 1, endLine: 1, text: 'x'.repeat(300) }],
      geometry(),
    );
    expect(m!.preview).toHaveLength(64);
    expect(m!.preview.endsWith('…')).toBe(true);
  });

  it('keeps who and a few lines of the words apart for the hover card', () => {
    const [t, n] = railMarks(
      [thread('t', { startLine: 1 })],
      [{ id: 'n', kind: 'note', startLine: 7, endLine: 7, text: 'y'.repeat(300) }],
      geometry(),
    );
    expect(t).toMatchObject({ who: '@ana', text: 'Rename this' });
    expect(n!.who).toBe('Note to agent');
    expect(n!.text).toHaveLength(240);
    expect(n!.text.endsWith('…')).toBe(true);
  });

  it('clamps to the rail and is empty before layout', () => {
    const [m] = railMarks([thread('t', { line: 500 })], [], geometry());
    expect(m!.at).toBe(1);
    expect(railMarks([thread('t')], [], geometry({ contentHeight: 0, railHeight: 0 }))).toEqual([]);
  });
});

describe('railChanges', () => {
  const change = (o1: number, o2: number, m1: number, m2: number) => ({
    originalStartLineNumber: o1,
    originalEndLineNumber: o2,
    modifiedStartLineNumber: m1,
    modifiedEndLineNumber: m2,
  });

  it('kinds additions, deletions and replacements', () => {
    const spans = railChanges(
      [change(4, 0, 5, 7), change(20, 22, 22, 22), change(40, 41, 40, 0)],
      geometry(),
    );
    expect(spans.map((s) => [s.kind, s.startLine, s.endLine])).toEqual([
      ['add', 5, 7],
      ['mod', 22, 22],
      ['del', 40, 40],
    ]);
  });

  it('spans an addition over its lines, scaled into the rail', () => {
    const [s] = railChanges([change(4, 0, 5, 7)], geometry());
    // Lines 5–7 are 40–70px of 1000.
    expect(s!.at).toBeCloseTo(0.04);
    expect(s!.size).toBeCloseTo(0.03);
  });

  it('anchors a deletion under the line it follows, as a point', () => {
    const [s] = railChanges([change(40, 41, 40, 0)], geometry());
    // Line 40 ends at 400px.
    expect(s).toMatchObject({ kind: 'del', at: 0.4, size: 0 });
    const [top] = railChanges([change(1, 2, 0, 0)], geometry());
    expect(top).toMatchObject({ kind: 'del', startLine: 0, at: 0 });
  });

  it('places by the editor geometry, so view zones above push changes down', () => {
    const zoned = geometry({ topFor: (line) => (line - 1) * 10 + (line > 2 ? 200 : 0) });
    const [s] = railChanges([change(1, 0, 3, 3)], zoned);
    expect(s!.at).toBeCloseTo(0.22);
  });

  it('merges changes of a kind whose least-height bars would touch', () => {
    // 1000px of content on a 100px rail: a line is a rail pixel, so each
    // one-line change draws at the 8px least height.
    const g = geometry({ railHeight: 100 });
    const spans = railChanges(
      [change(1, 0, 2, 2), change(5, 0, 6, 6), change(3, 4, 5, 5), change(9, 0, 30, 31)],
      g,
    );
    expect(spans.map((s) => [s.kind, s.startLine, s.endLine])).toEqual([
      ['add', 2, 6],
      ['mod', 5, 5],
      ['add', 30, 31],
    ]);
    expect(spans[0]!.size).toBeCloseTo(0.05);
  });

  it('keeps changes apart whose bars do not touch, on a short or a long file', () => {
    // Short: 100 lines on a 1000px rail, lines 10px; 8 lines apart stays two.
    expect(
      railChanges([change(1, 0, 2, 2), change(9, 0, 10, 10)], geometry({ railHeight: 1000 })),
    ).toHaveLength(2);
    // Long: 10,000 lines on a 500px rail, a rail pixel is 20 lines; 200 apart stays two.
    expect(
      railChanges(
        [change(1, 0, 100, 100), change(299, 0, 300, 300)],
        geometry({ contentHeight: 100_000 }),
      ),
    ).toHaveLength(2);
  });

  it('is empty before layout', () => {
    expect(
      railChanges([change(1, 0, 1, 1)], geometry({ contentHeight: 0, railHeight: 0 })),
    ).toEqual([]);
  });
});
