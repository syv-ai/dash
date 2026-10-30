import { describe, it, expect } from 'vitest';
import { searchFiles } from '../fileSearch';

const paths = [
  'src/renderer/components/diffEditor/EditorSidebar.tsx',
  'src/renderer/components/diffEditor/types.ts',
  'src/main/ipc/editorIpc.ts',
  'docs/editor/sidebar-notes.md',
  'README.md',
];

describe('searchFiles', () => {
  it('matches a subsequence of the file name', () => {
    const hits = searchFiles(paths, 'edsb');
    expect(hits[0]?.path).toBe('src/renderer/components/diffEditor/EditorSidebar.tsx');
  });

  it('is case-insensitive', () => {
    expect(searchFiles(paths, 'README').map((h) => h.path)).toContain('README.md');
    expect(searchFiles(paths, 'readme').map((h) => h.path)).toContain('README.md');
  });

  it('ranks file-name matches above directory-only matches', () => {
    const hits = searchFiles(paths, 'editor');
    const names = hits.map((h) => h.path);
    expect(names.indexOf('src/main/ipc/editorIpc.ts')).toBeLessThan(
      names.indexOf('docs/editor/sidebar-notes.md'),
    );
  });

  it('returns indices into the path for highlighting', () => {
    const [hit] = searchFiles(['a/bcd.ts'], 'bd');
    expect(hit?.indices).toEqual([2, 4]);
  });

  it('returns nothing when the query is not a subsequence', () => {
    expect(searchFiles(paths, 'zzz')).toEqual([]);
  });

  it('returns nothing for a blank query', () => {
    expect(searchFiles(paths, '  ')).toEqual([]);
  });

  it('caps the number of results', () => {
    const many = Array.from({ length: 500 }, (_, i) => `f/file${i}.ts`);
    expect(searchFiles(many, 'file', 50)).toHaveLength(50);
  });
});
