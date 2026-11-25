/*
 * The file tree's model, pure: building a tree from changed files (and, for a
 * whole-repo tree, every listed path), folding single-child folder chains,
 * which folders are open, and the visible rows as one flat list that the
 * component windows. Every file tree in the app (Files, a PR's files, the
 * editor modal) renders these rows through `FileTree`.
 */
import type { DirEntry, FileChange, RepoListing } from '../../../shared/types';
import { treeOrder, folderOrder } from './treeOrder';

export interface TreeFile {
  name: string;
  path: string;
  /** Its change in this tree's view; null for an unchanged file. A gitignored
   *  file listed by "all files" carries a zero-stat `ignored` change. */
  change: FileChange | null;
  /** Gitignored, or inside an ignored folder: shown quietly. */
  ignored: boolean;
}

/** What a folder holds beneath it, for its row and its bulk actions. */
export interface FolderTally {
  /** Changed files beneath it (ignored ones are listed, not counted). */
  changed: number;
  /** Lines added and removed by its tracked changes. */
  add: number;
  del: number;
  /** Lines of its untracked files (their size, not edits). */
  untrackedAdd: number;
  /** Changed files beneath it that are staged. */
  staged: number;
}

export interface TreeFolder {
  name: string;
  /** Repo-relative; '' for the root. */
  path: string;
  folders: Map<string, TreeFolder>;
  /** In display order. */
  files: TreeFile[];
  /** Git lists it as one entry (ignored, or a symlink): its contents are read
   *  from disk when it opens, one level at a time. */
  lazy: boolean;
  ignored: boolean;
  /** Its own change, when git sees the folder as one entry (an untracked
   *  symlinked directory). */
  change: FileChange | null;
  tally: FolderTally;
}

/** Every file at the tree's source, beside its changes ("all files"). */
export interface RepoFiles {
  paths: readonly string[];
  /** Folders git lists as one entry (symlinked ones): listed when opened. */
  dirs: readonly string[];
  /** Gitignored files and folders (the working tree's). */
  ignored?: RepoListing;
}

/** Folders with more changed files than this start collapsed. */
export const SMART_COLLAPSE_THRESHOLD = 20;

const zeroTally = (): FolderTally => ({ changed: 0, add: 0, del: 0, untrackedAdd: 0, staged: 0 });

function newFolder(
  name: string,
  path: string,
  opts: { lazy?: boolean; ignored?: boolean } = {},
): TreeFolder {
  return {
    name,
    path,
    folders: new Map(),
    files: [],
    lazy: opts.lazy ?? false,
    ignored: opts.ignored ?? false,
    change: null,
    tally: zeroTally(),
  };
}

/** The folder at `parts` under `root`, made (with its parents) if missing. */
function folderAt(root: TreeFolder, parts: readonly string[]): TreeFolder {
  let node = root;
  for (const seg of parts) {
    let child = node.folders.get(seg);
    if (!child) {
      child = newFolder(seg, node.path ? `${node.path}/${seg}` : seg);
      node.folders.set(seg, child);
    }
    node = child;
  }
  return node;
}

function count(t: FolderTally, c: FileChange) {
  t.changed++;
  if (c.staged) t.staged++;
  if (c.status === 'untracked') t.untrackedAdd += c.additions;
  else {
    t.add += c.additions;
    t.del += c.deletions;
  }
}

function tallyUp(node: TreeFolder): FolderTally {
  const t = zeroTally();
  if (node.change) count(t, node.change);
  for (const f of node.files) if (f.change && f.change.status !== 'ignored') count(t, f.change);
  for (const child of node.folders.values()) {
    const c = tallyUp(child);
    t.changed += c.changed;
    t.add += c.add;
    t.del += c.del;
    t.untrackedAdd += c.untrackedAdd;
    t.staged += c.staged;
  }
  node.tally = t;
  return t;
}

/**
 * The tree of `changes` (one per path; a later one wins), or with `repo`
 * every file there too: its symlinked folders lazy, its ignored files quiet
 * and its ignored folders lazy and quiet.
 */
export function buildTree(changes: readonly FileChange[], repo?: RepoFiles): TreeFolder {
  const byPath = new Map<string, FileChange>();
  for (const c of changes) byPath.set(c.path, c);
  const root = newFolder('', '');

  // Folders git lists as one entry. An untracked symlinked directory is also
  // a change: it becomes the folder's own.
  const lazy = new Set<string>();
  const addLazy = (p: string, ignored: boolean) => {
    const folder = folderAt(root, p.split('/'));
    folder.lazy = true;
    folder.ignored = ignored;
    folder.change = byPath.get(p) ?? null;
    lazy.add(p);
  };
  for (const p of repo?.dirs ?? []) addLazy(p, false);
  for (const p of repo?.ignored?.dirs ?? []) addLazy(p, true);

  // Deleted files are in `changes` but not the listing: the union.
  const ignoredFiles = new Set(repo?.ignored?.files);
  const all = new Set<string>(repo?.paths);
  for (const p of byPath.keys()) all.add(p);
  for (const p of ignoredFiles) all.add(p);

  for (const p of [...all].sort(treeOrder)) {
    if (lazy.has(p)) continue;
    const parts = p.split('/');
    const ignored = !byPath.has(p) && ignoredFiles.has(p);
    folderAt(root, parts.slice(0, -1)).files.push({
      name: parts[parts.length - 1]!,
      path: p,
      change:
        byPath.get(p) ??
        (ignored
          ? { path: p, status: 'ignored', staged: false, additions: 0, deletions: 0 }
          : null),
      ignored,
    });
  }
  tallyUp(root);
  return root;
}

/** A lazy folder's contents as read from disk: one level, its subfolders
 *  lazy in turn, quiet when it is. */
export function listedFolder(folder: TreeFolder, entries: readonly DirEntry[]): TreeFolder {
  const node = newFolder(folder.name, folder.path, { ignored: folder.ignored });
  for (const e of entries) {
    const path = `${folder.path}/${e.name}`;
    if (e.dir) {
      node.folders.set(e.name, newFolder(e.name, path, { lazy: true, ignored: folder.ignored }));
    } else {
      node.files.push({ name: e.name, path, change: null, ignored: folder.ignored });
    }
  }
  return node;
}

/** A folder's subfolders in display order. */
export function sortedFolders(node: TreeFolder): TreeFolder[] {
  return [...node.folders.values()].sort((a, b) => folderOrder(a.name, b.name));
}

/** Every change beneath `node`, its own included. */
export function subtreeChanges(node: TreeFolder): FileChange[] {
  const out: FileChange[] = [];
  (function walk(n: TreeFolder) {
    if (n.change) out.push(n.change);
    for (const f of n.files) if (f.change && f.change.status !== 'ignored') out.push(f.change);
    for (const child of n.folders.values()) walk(child);
  })(node);
  return out;
}

/** A folder and its single-folder descendants, shown as one row
 *  ("src/renderer/components"): `terminal` is the last, whose contents show. */
export function folded(folder: TreeFolder): {
  name: string;
  terminal: TreeFolder;
  /** Every folder the row stands for, outermost first. */
  chain: string[];
} {
  let cur = folder;
  let name = folder.name;
  const chain = [folder.path];
  while (cur.folders.size === 1 && cur.files.length === 0 && !cur.change) {
    cur = cur.folders.values().next().value!;
    name = `${name}/${cur.name}`;
    chain.push(cur.path);
  }
  return { name, terminal: cur, chain };
}

// ── Rows ─────────────────────────────────────────────────────

/** One tree in a `FileTree`: all files is one; Files' changes are two. */
export interface TreeSection {
  id: string;
  /** Its header row; none for a tree of one section. */
  label?: string;
  tree: TreeFolder;
}

/** The row that reads as current: a path, in one section or any. */
export interface TreeSelection {
  path: string;
  section?: string;
}

/** A lazy folder's listing: its entries, or why it couldn't be read.
 *  Absent while it loads. */
export type Listing = readonly DirEntry[] | { error: string };

export interface TreeState {
  /** Open or closed by the user (or a reveal), by `openKey`; any other
   *  folder takes its default (`defaultOpen`). */
  open: ReadonlyMap<string, boolean>;
  /** Lazy folders read so far, by path. */
  listings: ReadonlyMap<string, Listing>;
  selected: TreeSelection | null;
}

export type TreeRow =
  | { kind: 'section'; key: string; section: string; label: string }
  | {
      kind: 'folder';
      key: string;
      section: string;
      depth: number;
      /** Its name, a folded chain's joined ("a/b/c"). */
      name: string;
      /** The chain's last folder: its path, tally and contents. */
      folder: TreeFolder;
      chain: readonly string[];
      open: boolean;
    }
  | { kind: 'file'; key: string; section: string; depth: number; file: TreeFile }
  /** A lazy folder's state while it has no rows: loading, empty or failed. */
  | { kind: 'note'; key: string; section: string; depth: number; text: string; failed: boolean };

export type ItemRow = Extract<TreeRow, { kind: 'folder' | 'file' }>;

export const openKey = (section: string, path: string) => `${section}:${path}`;

const contains = (folder: TreeFolder, path: string) => path.startsWith(`${folder.path}/`);

/** Open unless the user says otherwise: a folder holding changes (not too
 *  many to read through) or the selected file. A lazy folder starts closed:
 *  opening it is what reads it. */
export function defaultOpen(folder: TreeFolder, selectedPath: string | null): boolean {
  if (folder.lazy) return false;
  if (selectedPath !== null && contains(folder, selectedPath)) return true;
  return folder.tally.changed > 0 && folder.tally.changed <= SMART_COLLAPSE_THRESHOLD;
}

const selectedIn = (state: TreeState, section: string): string | null =>
  state.selected && (state.selected.section ?? section) === section ? state.selected.path : null;

export function isOpen(state: TreeState, section: string, folder: TreeFolder): boolean {
  return (
    state.open.get(openKey(section, folder.path)) ?? defaultOpen(folder, selectedIn(state, section))
  );
}

/** The rows on show, in order: each section's header, then its folders
 *  (folded, depth first) ahead of its files; a closed folder is one row. */
export function flattenTree(sections: readonly TreeSection[], state: TreeState): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const { id, label, tree } of sections) {
    if (label !== undefined) rows.push({ kind: 'section', key: `${id}:s`, section: id, label });
    const walk = (node: TreeFolder, depth: number) => {
      for (const child of sortedFolders(node)) {
        const { name, terminal, chain } = folded(child);
        const open = isOpen(state, id, terminal);
        rows.push({
          kind: 'folder',
          key: `${id}:d:${terminal.path}`,
          section: id,
          depth,
          name,
          folder: terminal,
          chain,
          open,
        });
        if (!open) continue;
        if (!terminal.lazy) {
          walk(terminal, depth + 1);
          continue;
        }
        const listing = state.listings.get(terminal.path);
        const note = (text: string, failed = false) =>
          rows.push({
            kind: 'note',
            key: `${id}:n:${terminal.path}`,
            section: id,
            depth: depth + 1,
            text,
            failed,
          });
        if (!listing) note('Loading…');
        else if ('error' in listing) note(listing.error, true);
        else if (listing.length === 0) note('Empty');
        else walk(listedFolder(terminal, listing), depth + 1);
      }
      for (const file of node.files) {
        rows.push({ kind: 'file', key: `${id}:f:${file.path}`, section: id, depth, file });
      }
    };
    walk(tree, 0);
  }
  return rows;
}

/** Whether `row` is the selection. */
export function isSelected(row: TreeRow, selected: TreeSelection | null): boolean {
  return (
    row.kind === 'file' &&
    selected !== null &&
    row.file.path === selected.path &&
    (selected.section ?? row.section) === row.section
  );
}

/** The folders to open so `path` shows: every one holding it, and itself. */
export function revealKeys(sections: readonly TreeSection[], path: string): string[] {
  const keys: string[] = [];
  const parts = path.split('/');
  for (const { id } of sections) {
    for (let i = 1; i <= parts.length; i++) keys.push(openKey(id, parts.slice(0, i).join('/')));
  }
  return keys;
}

/** The row standing for folder `path` (a folded chain covers several). */
export function folderRowIndex(rows: readonly TreeRow[], path: string): number {
  return rows.findIndex((r) => r.kind === 'folder' && r.chain.includes(path));
}

// ── Columns ──────────────────────────────────────────────────

/** A file's badges: your notes and comments needing attention, and (in a
 *  PR's view) the PR's unresolved threads on it. */
export interface FileBadges {
  comments: number;
  threads: number;
  /** Its changes in the index (a whole tree, which has no Staged section):
   *  all of them, or some. */
  staged?: true | 'mixed';
}

/** The trailing columns, each as wide as the tree's widest value (in `ch`)
 *  so rows line up; 0 or false: no row fills it, so it isn't drawn. */
export interface TreeColumns {
  threads: boolean;
  comments: boolean;
  add: number;
  del: number;
  /** A file's status letter (folders show none). */
  status: boolean;
}

const signed = (n: number) => (n > 0 ? String(n).length + 1 : 0);

export function treeColumns(
  sections: readonly TreeSection[],
  badges?: ReadonlyMap<string, FileBadges>,
): TreeColumns {
  const cols: TreeColumns = { threads: false, comments: false, add: 0, del: 0, status: false };
  const walk = (node: TreeFolder) => {
    for (const f of node.files) {
      const b = badges?.get(f.path);
      if (b?.threads) cols.threads = true;
      if (b?.comments) cols.comments = true;
      if (!f.change) continue;
      cols.status = true;
      cols.add = Math.max(cols.add, signed(f.change.additions));
      cols.del = Math.max(cols.del, signed(f.change.deletions));
    }
    for (const child of node.folders.values()) {
      const t = child.tally;
      if (t.changed > 0) {
        // A closed folder shows its lines in the same columns.
        cols.add = Math.max(cols.add, signed(t.add + t.untrackedAdd));
        cols.del = Math.max(cols.del, signed(t.del));
      }
      walk(child);
    }
  };
  for (const s of sections) walk(s.tree);
  return cols;
}

// ── Keys ─────────────────────────────────────────────────────

/** What a key does on the focused row (index into the rows): focus another,
 *  or open/close a folder. Null: not the tree's key. */
export type TreeKeyAction = { focus: number } | { toggle: number } | null;

const focusable = (r: TreeRow | undefined) => r?.kind === 'folder' || r?.kind === 'file';

/** Arrow keys walk the rows (headers and notes skipped), Home and End jump
 *  to the ends; Right opens a folder (then steps in), Left closes it (or
 *  steps out to its folder). */
export function treeKey(rows: readonly TreeRow[], index: number, key: string): TreeKeyAction {
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (focusable(rows[i])) return i;
    return null;
  };
  const to = (i: number | null) => (i === null ? null : { focus: i });
  const row = rows[index];
  switch (key) {
    case 'ArrowDown':
      return to(step(index, 1));
    case 'ArrowUp':
      return to(step(index, -1));
    case 'Home':
      return to(step(-1, 1));
    case 'End':
      return to(step(rows.length, -1));
    case 'ArrowRight':
      if (row?.kind !== 'folder') return null;
      return row.open ? to(step(index, 1)) : { toggle: index };
    case 'ArrowLeft': {
      if (row?.kind === 'folder' && row.open) return { toggle: index };
      if (!row || !focusable(row)) return null;
      const depth = (row as ItemRow).depth;
      for (let i = index - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.section !== row.section) return null;
        if (r.kind === 'folder' && r.depth < depth) return { focus: i };
      }
      return null;
    }
    default:
      return null;
  }
}
