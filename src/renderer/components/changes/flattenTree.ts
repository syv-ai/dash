import { compressedDisplay, type TreeNode } from './buildTree';
import type { FileChange } from '../../../shared/types';

/** Folders with more files than this start collapsed. */
export const SMART_COLLAPSE_THRESHOLD = 20;
/** Folders with more direct files than this show only the first ones until "Show all". */
export const FOLDER_TRUNCATION_CAP = 30;

export type FlatRow =
  | {
      kind: 'folder';
      key: string;
      display: string;
      terminal: TreeNode;
      indent: number;
      open: boolean;
    }
  | { kind: 'file'; key: string; file: FileChange; indent: number }
  | { kind: 'more'; key: string; folderPath: string; hidden: number };

export interface FlattenState {
  /** Folder path → open, for folders the user toggled; others use the smart default. */
  open: ReadonlyMap<string, boolean>;
  /** Folder paths whose file list the user expanded past the truncation cap. */
  showAll: ReadonlySet<string>;
}

export function folderOpen(terminal: TreeNode, state: FlattenState): boolean {
  return state.open.get(terminal.path) ?? terminal.agg.count <= SMART_COLLAPSE_THRESHOLD;
}

/**
 * The rows `TreeNodeView` would show for `root`, in order, as a flat list:
 * folders (compressed like `a/b/c`), then each folder's files, with a "more"
 * row where a big folder is truncated. Collapsed folders contribute only
 * their own row, so the list holds what is visible and nothing else.
 */
export function flattenTree(root: TreeNode, state: FlattenState, keyPrefix = ''): FlatRow[] {
  const rows: FlatRow[] = [];
  (function walk(node: TreeNode, indent: number) {
    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const { display, terminal } = compressedDisplay(child);
      const open = folderOpen(terminal, state);
      rows.push({
        kind: 'folder',
        key: `${keyPrefix}d:${terminal.path}`,
        display,
        terminal,
        indent,
        open,
      });
      if (open) walk(terminal, indent + 1);
    }
    const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
    const truncate = files.length > FOLDER_TRUNCATION_CAP && !state.showAll.has(node.path);
    for (const file of truncate ? files.slice(0, FOLDER_TRUNCATION_CAP) : files) {
      rows.push({ kind: 'file', key: `${keyPrefix}f:${file.path}`, file, indent });
    }
    if (truncate) {
      rows.push({
        kind: 'more',
        key: `${keyPrefix}m:${node.path}`,
        folderPath: node.path,
        hidden: files.length - FOLDER_TRUNCATION_CAP,
      });
    }
  })(root, 0);
  return rows;
}
