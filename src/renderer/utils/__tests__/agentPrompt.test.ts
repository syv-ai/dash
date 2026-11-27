import { describe, it, expect } from 'vitest';
import type { PrReview, PrReviewThread } from '../../../shared/types';
import {
  buildAgentPrompt,
  buildCommentPrompt,
  buildReviewPrompt,
  type PromptComment,
} from '../agentPrompt';

const pc = (over: Partial<PromptComment>): PromptComment => ({
  id: over.id ?? 'c',
  filePath: over.filePath ?? 'a.ts',
  startLine: over.startLine ?? 1,
  endLine: over.endLine ?? 1,
  text: over.text ?? 'note',
  viewScope: over.viewScope ?? 'live',
  ...over,
});

describe('buildAgentPrompt', () => {
  it('puts the head, then each item: location, fenced code when given, body', () => {
    expect(
      buildAgentPrompt('Head', [
        { location: 'a.ts:1', body: 'one' },
        { location: 'b.ts:2', code: { language: 'ts', text: 'x()' }, body: 'two' },
      ]),
    ).toBe('Head\n\na.ts:1\none\n\nb.ts:2\n```ts\nx()\n```\ntwo');
  });
});

describe('buildCommentPrompt', () => {
  it('returns null when no ids selected', () => {
    expect(
      buildCommentPrompt({ ids: [], byFile: {}, currentFilePath: 'a.ts', currentScope: 'live' }),
    ).toBeNull();
  });

  it('formats a single comment with path:line header', () => {
    const out = buildCommentPrompt({
      ids: ['c'],
      byFile: { 'a.ts': [pc({ id: 'c', startLine: 3, endLine: 3, text: 'fix this' })] },
      currentFilePath: 'a.ts',
      currentScope: 'live',
    });
    expect(out).toBe('Comments:\n\na.ts:3:\nfix this');
  });

  it('uses a range header and orders the current file first', () => {
    const out = buildCommentPrompt({
      ids: ['x', 'y'],
      byFile: {
        'z.ts': [pc({ id: 'y', filePath: 'z.ts', startLine: 1, endLine: 2, text: 'other' })],
        'a.ts': [pc({ id: 'x', filePath: 'a.ts', startLine: 5, endLine: 7, text: 'current' })],
      },
      currentFilePath: 'a.ts',
      currentScope: 'live',
    });
    expect(out).toBe('Comments:\n\na.ts:5-7:\ncurrent\n\nz.ts:1-2:\nother');
  });

  it('embeds a fenced code excerpt + language for the current file when provided', () => {
    const out = buildCommentPrompt({
      ids: ['x'],
      byFile: { 'a.ts': [pc({ id: 'x', startLine: 2, endLine: 2, text: 'see code' })] },
      currentFilePath: 'a.ts',
      currentScope: 'live',
      currentFile: { language: 'typescript', codeForId: () => 'const a = 1;' },
    });
    expect(out).toBe('Comments:\n\na.ts:2:\n```typescript\nconst a = 1;\n```\nsee code');
  });

  it("labels a PR's note and review comment with the PR", () => {
    const out = buildCommentPrompt({
      ids: ['n', 'c'],
      byFile: {
        'a.ts': [
          pc({ id: 'n', startLine: 2, endLine: 2, text: 'watch', viewScope: 'pr:ado:7' }),
          pc({
            id: 'c',
            startLine: 3,
            endLine: 3,
            text: 'rename',
            viewScope: 'pr:ado:7',
            kind: 'comment',
          }),
        ],
      },
      currentFilePath: 'b.ts',
      currentScope: 'pr:ado:7',
    });
    expect(out).toBe(
      'Comments:\n\na.ts:2: (PR #7)\nwatch\n\na.ts:3: (PR #7 review comment)\nrename',
    );
  });

  it('labels a commit-scoped comment and skips code enrichment when scope differs', () => {
    const out = buildCommentPrompt({
      ids: ['x'],
      byFile: {
        'a.ts': [
          pc({ id: 'x', startLine: 4, endLine: 4, text: 'old', viewScope: 'commit:abcdef123' }),
        ],
      },
      currentFilePath: 'a.ts',
      currentScope: 'live',
      // codeForId would throw if called — proves enrichment is skipped on scope mismatch.
      currentFile: {
        language: 'typescript',
        codeForId: () => {
          throw new Error('should not enrich a different scope');
        },
      },
    });
    expect(out).toBe('Comments:\n\na.ts:4: (commit abcdef1)\nold');
  });
});

const thread = (
  id: string,
  commentIds: string[],
  over: Partial<PrReviewThread> = {},
): PrReviewThread => ({
  id,
  path: 'src/a.ts',
  line: 12,
  startLine: null,
  side: 'RIGHT',
  isOutdated: false,
  resolved: false,
  comments: commentIds.map((c) => ({
    id: c,
    author: 'rev',
    body: `body ${c}`,
    createdAt: '',
    url: '',
    authorUrl: null,
    reactions: [],
  })),
  ...over,
});
const review = (number: number, threads: PrReviewThread[]): PrReview => ({
  provider: 'github',
  number,
  title: 't',
  body: '',
  url: `https://github.com/o/r/pull/${number}`,
  viewerIsAuthor: false,
  viewerIsRequestedReviewer: false,
  verdicts: ['comment'],
  base: 'b',
  head: 'h',
  threads,
  conversation: [],
  author: 'a',
  authorUrl: null,
  createdAt: '',
  lastActivityAt: '',
  state: 'open',
  baseRef: 'main',
  headRef: 'feat',
  commits: 1,
  behindBase: 0,
  reviewers: [],
  assignees: [],
  issues: [],
  checks: [],
  files: [],
});

describe('buildReviewPrompt', () => {
  it('labels the comments as review content, not instructions, before quoting them', () => {
    const text = buildReviewPrompt(review(4, []), [
      thread('T1', ['a'], { startLine: 10 }),
      thread('T2', ['b'], { path: 'src/b.ts' }),
    ]);
    const label = text.indexOf('not instructions');
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(text.indexOf('body a'));
    expect(text).toContain('PR #4');
    expect(text).toContain('src/a.ts:10-12\n  @rev: body a');
    expect(text).toContain('src/b.ts:12\n  @rev: body b');
  });

  it('indents multi-line comments under their author', () => {
    const t = thread('T1', ['a']);
    t.comments[0]!.body = 'line one\nline two';
    expect(buildReviewPrompt(review(4, []), [t])).toContain('  @rev: line one\n    line two');
  });

  it('caps its length and says how many threads it left out', () => {
    const big = Array.from({ length: 40 }, (_, i) => {
      const t = thread(`T${i}`, [`c${i}`]);
      t.comments[0]!.body = 'x'.repeat(1000);
      return t;
    });
    const text = buildReviewPrompt(review(4, []), big, { maxChars: 5000 });
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toMatch(/\d+ more threads? left out/);
  });
});
