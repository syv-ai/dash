import { describe, it, expect } from 'vitest';
import { parsePorcelainV2Z } from '../GitService';
import type { FileChange } from '../../../shared/types';

/**
 * `git status --porcelain=v2 -z` emits NUL-terminated records. Unlike the
 * non-`-z` form, paths are VERBATIM — never C-quoted — so a path with a space,
 * a double-quote, or a non-ASCII byte arrives intact. Renames put the original
 * path in a SEPARATE trailing NUL field rather than inline after a tab.
 */

// Build a NUL-delimited blob the way git does: every record (and a rename's
// trailing origPath) is NUL-terminated.
function blob(...records: string[]): string {
  return records.map((r) => r + '\0').join('');
}

function find(files: FileChange[], path: string, staged: boolean): FileChange | undefined {
  return files.find((f) => f.path === path && f.staged === staged);
}

describe('parsePorcelainV2Z', () => {
  it('returns nothing for empty output', () => {
    expect(parsePorcelainV2Z('')).toEqual([]);
  });

  it('parses an ordinary unstaged modification', () => {
    const out = blob('1 .M N... 100644 100644 100644 aaa bbb src/foo.ts');
    const files = parsePorcelainV2Z(out);
    expect(files).toHaveLength(1);
    expect(find(files, 'src/foo.ts', false)).toMatchObject({
      status: 'modified',
      staged: false,
    });
  });

  it('emits separate staged and unstaged entries when both index and worktree changed', () => {
    const out = blob('1 MM N... 100644 100644 100644 aaa bbb src/foo.ts');
    const files = parsePorcelainV2Z(out);
    expect(find(files, 'src/foo.ts', true)).toMatchObject({ status: 'modified', staged: true });
    expect(find(files, 'src/foo.ts', false)).toMatchObject({ status: 'modified', staged: false });
  });

  it('ignores the "." placeholder in the XY columns', () => {
    // ".A" — index unchanged, worktree added.
    const out = blob('1 .A N... 000000 100644 100644 aaa bbb added.ts');
    const files = parsePorcelainV2Z(out);
    expect(files).toHaveLength(1);
    expect(find(files, 'added.ts', false)).toMatchObject({ status: 'added' });
  });

  it('preserves spaces in ordinary paths (no slicing-on-space breakage)', () => {
    const out = blob('1 .M N... 100644 100644 100644 aaa bbb src/my component.tsx');
    const files = parsePorcelainV2Z(out);
    expect(find(files, 'src/my component.tsx', false)).toBeDefined();
  });

  it('preserves a path containing a double-quote (verbatim under -z)', () => {
    const out = blob('1 .M N... 100644 100644 100644 aaa bbb weird"name.ts');
    const files = parsePorcelainV2Z(out);
    expect(find(files, 'weird"name.ts', false)).toBeDefined();
  });

  it('parses a staged rename, reading origPath from the trailing NUL field', () => {
    // "R." — staged rename, worktree clean. Score field (R100) precedes the path.
    const out = blob('2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts', 'old name.ts');
    const files = parsePorcelainV2Z(out);
    expect(files).toHaveLength(1);
    const renamed = find(files, 'new name.ts', true);
    expect(renamed).toMatchObject({ status: 'renamed', staged: true, oldPath: 'old name.ts' });
  });

  it('does not treat a rename origPath field as its own record', () => {
    const out = blob(
      '2 R. N... 100644 100644 100644 aaa bbb R100 dest.ts',
      'source.ts',
      '1 .M N... 100644 100644 100644 ccc ddd after.ts',
    );
    const files = parsePorcelainV2Z(out);
    // dest (renamed) + after (modified) — source.ts must NOT appear as a path.
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.path === 'source.ts')).toBe(false);
    expect(find(files, 'after.ts', false)).toBeDefined();
  });

  it('parses an untracked file with a space', () => {
    const out = blob('? notes draft.md');
    const files = parsePorcelainV2Z(out);
    expect(find(files, 'notes draft.md', false)).toMatchObject({ status: 'untracked' });
  });

  it('parses an unmerged (conflicted) entry', () => {
    const out = blob('u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict file.ts');
    const files = parsePorcelainV2Z(out);
    expect(find(files, 'conflict file.ts', false)).toMatchObject({ status: 'conflicted' });
  });

  it('handles a mixed batch in one blob', () => {
    const out = blob(
      '1 .M N... 100644 100644 100644 aaa bbb a.ts',
      '2 R. N... 100644 100644 100644 ccc ddd R100 b new.ts',
      'b old.ts',
      '? c.ts',
    );
    const files = parsePorcelainV2Z(out);
    expect(find(files, 'a.ts', false)).toMatchObject({ status: 'modified' });
    expect(find(files, 'b new.ts', true)).toMatchObject({ status: 'renamed', oldPath: 'b old.ts' });
    expect(find(files, 'c.ts', false)).toMatchObject({ status: 'untracked' });
  });
});
