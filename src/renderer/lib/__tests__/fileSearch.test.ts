import { describe, it, expect } from 'vitest';
import { searchFiles, describeHitCount } from '../fileSearch';

const paths = [
  'src/renderer/components/diffEditor/EditorSidebar.tsx',
  'src/renderer/components/diffEditor/types.ts',
  'src/main/ipc/editorIpc.ts',
  'docs/editor/sidebar-notes.md',
  'README.md',
];

describe('searchFiles', () => {
  it('matches a subsequence of the file name', () => {
    const { hits } = searchFiles(paths, 'edsb');
    expect(hits[0]?.path).toBe('src/renderer/components/diffEditor/EditorSidebar.tsx');
  });

  it('is case-insensitive', () => {
    expect(searchFiles(paths, 'README').hits.map((h) => h.path)).toContain('README.md');
    expect(searchFiles(paths, 'readme').hits.map((h) => h.path)).toContain('README.md');
  });

  // The ranking tests below pit the path a rule should favour against a rival
  // favoured by everything else (shorter, tighter), so the rule alone decides
  // the order. They assert order only, so the weights can be re-tuned without
  // touching them.
  const rankedFirst = (candidates: string[], query: string) =>
    searchFiles(candidates, query).hits[0]?.path;

  it('ranks a file-name match above a shorter directory-only match', () => {
    // The winner's match starts mid-word, so only being inside the name helps it.
    const dirOnly = 'editor/n.md';
    const inName = 'src/myeditor.ts';
    expect(rankedFirst([dirOnly, inName], 'editor')).toBe(inName);
    expect(rankedFirst([inName, dirOnly], 'editor')).toBe(inName);
  });

  it('ranks matches on word starts above mid-word matches', () => {
    const plain = 'foobar.ts';
    const boundary = 'foo_bar.ts';
    expect(rankedFirst([plain, boundary], 'fb')).toBe(boundary);
    expect(rankedFirst([boundary, plain], 'fb')).toBe(boundary);
  });

  it('ranks a camelCase word start above a mid-word match', () => {
    const plain = 'fxb.ts';
    const camel = 'fooBar.ts';
    expect(rankedFirst([plain, camel], 'fb')).toBe(camel);
    expect(rankedFirst([camel, plain], 'fb')).toBe(camel);
  });

  it('ranks a match starting at the file name above one starting inside it', () => {
    const inside = 'src/a_fb.ts';
    const atStart = 'src/fb-notes-extra.ts';
    expect(rankedFirst([inside, atStart], 'fb')).toBe(atStart);
    expect(rankedFirst([atStart, inside], 'fb')).toBe(atStart);
  });

  it('ranks a consecutive run above a scattered match', () => {
    // Neither starts a word at the file name, so the run is what separates them.
    const run = 'src/_xabc.ts';
    const scattered = 'src/_a-xbxc.ts';
    expect(rankedFirst([run, scattered], 'abc')).toBe(run);
    expect(rankedFirst([scattered, run], 'abc')).toBe(run);
  });

  it('returns indices into the path for highlighting', () => {
    const [hit] = searchFiles(['a/bcd.ts'], 'bd').hits;
    expect(hit?.indices).toEqual([2, 4]);
  });

  it('returns nothing when the query is not a subsequence', () => {
    expect(searchFiles(paths, 'zzz')).toEqual({ hits: [], total: 0 });
  });

  it('returns nothing for a blank query', () => {
    expect(searchFiles(paths, '  ')).toEqual({ hits: [], total: 0 });
  });

  it('caps the listed results but counts every match', () => {
    const many = Array.from({ length: 500 }, (_, i) => `f/file${i}.ts`);
    const result = searchFiles(many, 'file', 50);
    expect(result.hits).toHaveLength(50);
    expect(result.total).toBe(500);
  });

  it('lists equally good matches in path order, whatever the input order', () => {
    // Same shape, so the scores are identical and only the tie-break orders them.
    const order = (input: string[]) => searchFiles(input, 'x').hits.map((h) => h.path);
    expect(order(['a/x2.ts', 'a/x1.ts'])).toEqual(['a/x1.ts', 'a/x2.ts']);
    expect(order(['a/x1.ts', 'a/x2.ts'])).toEqual(['a/x1.ts', 'a/x2.ts']);
  });

  it('ignores spaces in the query', () => {
    const spaced = searchFiles(paths, 'ed sb');
    expect(spaced.hits.length).toBeGreaterThan(0);
    expect(spaced.hits).toEqual(searchFiles(paths, 'edsb').hits);
    expect(searchFiles(paths, '   ').hits).toEqual([]);
  });

  it('ranks a tighter match above a looser one over the same letters', () => {
    // Same length, same word starts, no runs: only the gap between `a` and `x`
    // differs, and the looser path sorts first by name.
    const tight = 'a-x-b.ts';
    const loose = 'a-b-x.ts';
    expect(rankedFirst([loose, tight], 'ax')).toBe(tight);
    expect(rankedFirst([tight, loose], 'ax')).toBe(tight);
  });
});

describe('describeHitCount', () => {
  const files = (n: number) => Array.from({ length: n }, (_, i) => `f/file${i}.ts`);

  it('uses the singular for one file', () => {
    expect(describeHitCount(searchFiles(files(1), 'file', 10))).toBe('1 file');
  });

  it('counts several files', () => {
    expect(describeHitCount(searchFiles(files(146), 'file', 200))).toBe('146 files');
  });

  it('gives the exact count when the matches just fill the cap', () => {
    expect(describeHitCount(searchFiles(files(10), 'file', 10))).toBe('10 files');
  });

  it('says how many are listed when the cap cuts the list short', () => {
    expect(describeHitCount(searchFiles(files(500), 'file', 200))).toBe('200 of 500 files');
  });
});
