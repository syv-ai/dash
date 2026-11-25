/*
 * The order every file tree displays its paths in: depth first, a folder's
 * subfolders (by name, `localeCompare`) ahead of its files (by code unit, so
 * `README.md` comes before `package.json`). Anything that walks the files
 * "in order" (Changes' first change, next unviewed, next thread) uses it.
 */

/** How a tree orders sibling folders by name. */
export const folderOrder = (a: string, b: string): number => a.localeCompare(b);

/** Paths in tree display order, folders unfolded. */
export function treeOrder(a: string, b: string): number {
  const pa = a.split('/');
  const pb = b.split('/');
  for (let i = 0; ; i++) {
    const fileA = i === pa.length - 1;
    const fileB = i === pb.length - 1;
    if (fileA !== fileB) return fileA ? 1 : -1;
    if (fileA) return a < b ? -1 : a > b ? 1 : 0;
    if (pa[i] !== pb[i]) return folderOrder(pa[i]!, pb[i]!);
  }
}
