/*
 * The order a file tree displays its paths in: depth first, a folder's
 * subfolders (by name, `localeCompare`) ahead of its files. The editor's tree
 * (Files, a PR's changes) orders a folder's files by code unit, so
 * `README.md` comes before `package.json` there; Changes orders them by
 * `localeCompare`. Anything that walks the files "in order" (next unviewed,
 * next thread) uses the order the tree shows.
 */

export type Order = (a: string, b: string) => number;

export const byCodeUnit: Order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const byLocale: Order = (a, b) => a.localeCompare(b);

/** How a tree orders sibling folders by name. */
export const folderOrder: Order = byLocale;

/** Paths in tree display order, a folder's files by `fileOrder`. */
export function treeOrder(fileOrder: Order): Order {
  return (a, b) => {
    const pa = a.split('/');
    const pb = b.split('/');
    for (let i = 0; ; i++) {
      const fileA = i === pa.length - 1;
      const fileB = i === pb.length - 1;
      if (fileA !== fileB) return fileA ? 1 : -1;
      if (fileA) return fileOrder(a, b);
      if (pa[i] !== pb[i]) return folderOrder(pa[i]!, pb[i]!);
    }
  };
}

/** Paths as the editor's tree (`EditorTree`) lists them, folders unfolded. */
export const editorTreeOrder: Order = treeOrder(byCodeUnit);
