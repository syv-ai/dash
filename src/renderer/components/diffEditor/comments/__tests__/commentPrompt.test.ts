import { describe, it, expect } from 'vitest';
import { buildCommentPrompt, type PromptComment } from '../commentPrompt';

const pc = (over: Partial<PromptComment>): PromptComment => ({
  id: over.id ?? 'c',
  filePath: over.filePath ?? 'a.ts',
  startLine: over.startLine ?? 1,
  endLine: over.endLine ?? 1,
  text: over.text ?? 'note',
  viewScope: over.viewScope ?? 'live',
  ...over,
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
