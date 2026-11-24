import { describe, expect, it } from 'vitest';
import { isStale, targetLocations, textEditsByUri, worktreeFor } from '../protocol';

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

describe('worktreeFor', () => {
  const roots = ['/repo', '/repo/.claude/worktrees/feat/', '/other'];

  it('picks the deepest worktree a file sits under', () => {
    expect(worktreeFor('/repo/src/a.ts', roots)).toBe('/repo');
    expect(worktreeFor('/repo/.claude/worktrees/feat/src/a.ts', roots)).toBe(
      '/repo/.claude/worktrees/feat',
    );
  });

  it('needs a whole path segment, and a file inside', () => {
    expect(worktreeFor('/repository/a.ts', roots)).toBeNull();
    expect(worktreeFor('/repo', roots)).toBeNull();
  });
});

describe('isStale', () => {
  it('drops results for versions older than the model, keeps the current one', () => {
    expect(isStale(3, 4)).toBe(true);
    expect(isStale(4, 4)).toBe(false);
  });
});

describe('targetLocations', () => {
  it('reads a location, a list, and links (at their selection range)', () => {
    const loc = { uri: 'file:///a.ts', range: range(1, 0, 3) };
    expect(targetLocations(null)).toEqual([]);
    expect(targetLocations(loc)).toEqual([loc]);
    expect(targetLocations([loc, loc])).toHaveLength(2);
    expect(
      targetLocations([
        {
          targetUri: 'file:///b.ts',
          targetRange: range(4, 0, 20),
          targetSelectionRange: range(4, 9, 12),
        },
      ]),
    ).toEqual([{ uri: 'file:///b.ts', range: range(4, 9, 12) }]);
  });
});

describe('textEditsByUri', () => {
  it('groups `changes`', () => {
    const e = { range: range(0, 6, 9), newText: 'bar' };
    const out = textEditsByUri({ changes: { 'file:///a.ts': [e], 'file:///b.ts': [e, e] } });
    expect(out.fileOperations).toBe(false);
    expect(out.edits.get('file:///a.ts')).toEqual([e]);
    expect(out.edits.get('file:///b.ts')).toHaveLength(2);
  });

  it('merges `documentChanges` per document and flags file operations', () => {
    const e = { range: range(0, 0, 1), newText: 'x' };
    const out = textEditsByUri({
      documentChanges: [
        { textDocument: { uri: 'file:///a.ts', version: 1 }, edits: [e] },
        { textDocument: { uri: 'file:///a.ts', version: 1 }, edits: [e] },
        { kind: 'rename', oldUri: 'file:///a.ts', newUri: 'file:///c.ts' },
      ],
    });
    expect(out.edits.get('file:///a.ts')).toHaveLength(2);
    expect(out.fileOperations).toBe(true);
  });

  it('is empty for no edit', () => {
    expect(textEditsByUri(null).edits.size).toBe(0);
  });
});
