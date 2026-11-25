import { describe, expect, it } from 'vitest';
import { editorTreeOrder } from '../treeOrder';

const sorted = (paths: string[]) => [...paths].sort(editorTreeOrder);

describe('editorTreeOrder', () => {
  it('lists a folder’s subfolders ahead of its files, depth first', () => {
    expect(sorted(['b.ts', 'src/z.ts', 'src/a/c.ts', 'a/x.ts'])).toEqual([
      'a/x.ts',
      'src/a/c.ts',
      'src/z.ts',
      'b.ts',
    ]);
  });

  it('keeps a folder’s files apart from a sibling folder that sorts between them', () => {
    expect(
      sorted(['c/review/SubmitReview.tsx', 'c/ui/Modal.tsx', 'c/diffEditor/EditorSidebar.tsx']),
    ).toEqual(['c/diffEditor/EditorSidebar.tsx', 'c/review/SubmitReview.tsx', 'c/ui/Modal.tsx']);
    expect(sorted(['c/a.ts', 'c/b/x.ts'])).toEqual(['c/b/x.ts', 'c/a.ts']);
  });

  it('orders files by code unit, folders by name', () => {
    expect(sorted(['package.json', 'README.md'])).toEqual(['README.md', 'package.json']);
    expect(sorted(['Zeta/a.ts', 'alpha/a.ts'])).toEqual(['alpha/a.ts', 'Zeta/a.ts']);
  });
});
