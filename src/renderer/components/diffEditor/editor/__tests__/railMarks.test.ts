import { describe, expect, it } from 'vitest';
import type { PrReviewThread } from '../../../../../shared/types';
import { railMarks, type RailGeometry } from '../railMarks';

const thread = (id: string, over: Partial<PrReviewThread> = {}): PrReviewThread => ({
  id,
  path: 'a.ts',
  line: 3,
  startLine: null,
  side: 'RIGHT',
  isOutdated: false,
  resolved: false,
  comments: [{ id: `${id}-c`, author: 'ana', body: 'Rename this\nplease', createdAt: '', url: '' }],
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
    // Line 50's middle is at 495 of 1000.
    expect(m!.at).toBeCloseTo(0.495);
  });

  it('keeps a short file beside its lines', () => {
    const [m] = railMarks([thread('t', { line: 5 })], [], geometry({ contentHeight: 100 }));
    // Line 5's middle is at 45px of a 500px rail.
    expect(m!.at).toBeCloseTo(0.09);
  });

  it('places by the editor geometry, so view zones above push marks down', () => {
    const zoned = geometry({ topFor: (line) => (line - 1) * 10 + (line > 2 ? 200 : 0) });
    const [m] = railMarks([thread('t', { line: 3 })], [], zoned);
    expect(m!.at).toBeCloseTo(0.225);
  });

  it('kinds threads, drafts and notes; skips threads off the code', () => {
    const marks = railMarks(
      [thread('open'), thread('done', { resolved: true }), thread('off', { line: null })],
      [
        { id: 'n', kind: 'note', startLine: 1, text: 'Check this' },
        { id: 'c', kind: 'comment', startLine: 2, text: 'Typo' },
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
      [{ id: 'c', kind: 'comment', startLine: 1, text: '' }],
      geometry(),
    );
    expect(marks.map((m) => m.id)).toEqual(['early', 'late', 'c']);
  });

  it('previews one line with where and who', () => {
    const marks = railMarks(
      [thread('t', { startLine: 1 })],
      [
        { id: 'n', kind: 'note', startLine: 7, text: '\n  Check the guard \nmore' },
        { id: 'c', kind: 'comment', startLine: 8, text: '' },
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
      [{ id: 'n', kind: 'note', startLine: 1, text: 'x'.repeat(300) }],
      geometry(),
    );
    expect(m!.preview).toHaveLength(64);
    expect(m!.preview.endsWith('…')).toBe(true);
  });

  it('clamps to the rail and is empty before layout', () => {
    const [m] = railMarks([thread('t', { line: 500 })], [], geometry());
    expect(m!.at).toBe(1);
    expect(railMarks([thread('t')], [], geometry({ contentHeight: 0, railHeight: 0 }))).toEqual([]);
  });
});
