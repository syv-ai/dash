/*
 * The file tree's model, pure: building a tree from changed files (and, for a
 * whole-repo tree, every listed path), folding single-child folder chains,
 * which folders are open, and the visible rows as one flat list that the
 * component windows. Every file tree in the app (Files, a PR's files, the
 * Agent tab's scratchpad) renders these rows through `FileTree`.
 */
import type { DirEntry, FileChange, RepoListing } from '../../../shared/types';
import { treeOrder, folderOrder } from './treeOrder';
import { treeKey as navKey, type TreeKeyAction, type TreeNode } from '../ui/treeNav';

export type { TreeKeyAction };

export interface TreeFile {
  name: string;
  path: string;
  /** Its change in this tree's view; null for an unchanged file. A gitignored
   *  file listed by "all files" carries a zero-stat `ignored` change. */
  change: FileChange | null;
  /** Gitignored, or inside an ignored folder: shown quietly, as its folder is. */
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
  /** Gitignored as a whole (git lists it as one ignored entry, or all it
   *  holds is ignored): shown quietly, and so is all it holds. */
  ignored: boolean;
  /** Untracked as a whole, as git sees a new folder: everything beneath it is
   *  untracked (or ignored), or git lists the folder itself as untracked. */
  untracked: boolean;
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
    untracked: false,
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

/** Marks each folder that git sees as one untracked or ignored whole, from
 *  what it holds: all of it ignored, or all untracked and ignored with
 *  something untracked. A lazy folder keeps what its listing said (its
 *  contents aren't known), a folder git lists as an untracked change is
 *  untracked. An empty folder is neither. */
function markWholes(node: TreeFolder): void {
  for (const child of node.folders.values()) markWholes(child);
  if (node.change?.status === 'untracked') node.untracked = true;
  if (node.lazy) return;
  let any = false;
  let allIgnored = true;
  let allNew = true;
  let someUntracked = false;
  const see = (ignored: boolean, untracked: boolean) => {
    any = true;
    if (!ignored) allIgnored = false;
    if (!ignored && !untracked) allNew = false;
    if (untracked) someUntracked = true;
  };
  for (const f of node.files) see(f.ignored, f.change?.status === 'untracked');
  for (const child of node.folders.values()) see(child.ignored, child.untracked);
  if (!any) return;
  node.ignored = allIgnored;
  node.untracked = node.untracked || (allNew && someUntracked);
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
  markWholes(root);
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

/** A row named in the `changed` gold (G1, G5), as VS Code tints it: a changed
 *  file (not an ignored one), or a folder with a change anywhere beneath it,
 *  its own included, open or closed. Reads the tally `buildTree` sums once. */
export function isChanged(row: ItemRow): boolean {
  if (row.kind === 'folder') return row.folder.tally.changed > 0;
  return !!row.file.change && row.file.change.status !== 'ignored';
}

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
  /** A PR's changed file: read through (true) or not; absent elsewhere. */
  viewed?: boolean;
}

/** `badges` with each of a PR's changed files marked viewed or not. */
export function withViewed(
  badges: ReadonlyMap<string, FileBadges>,
  changes: readonly { path: string }[],
  viewed: ReadonlySet<string>,
): Map<string, FileBadges> {
  const out = new Map(badges);
  for (const { path } of changes) {
    out.set(path, { comments: 0, threads: 0, ...badges.get(path), viewed: viewed.has(path) });
  }
  return out;
}

/** The trailing columns, each as wide as the widest value the tree shows
 *  (in `ch`) so rows line up; 0 or false: no row fills it, so it isn't drawn. */
export interface TreeColumns {
  threads: boolean;
  comments: boolean;
  add: number;
  del: number;
  /** A file's status letter (folders show none, but an untracked one's U). */
  status: boolean;
  /** A PR's viewed check (its tree marks files viewed). */
  viewed: boolean;
}

const signed = (n: number) => (n > 0 ? String(n).length + 1 : 0);

/** The columns that fit the rows shown: files' badges, lines and letters,
 *  and a closed folder's lines (an open one shows none, so its sum, wider
 *  than any of its files', reserves no room the names could use). */
export function treeColumns(
  rows: readonly TreeRow[],
  badges?: ReadonlyMap<string, FileBadges>,
): TreeColumns {
  const cols: TreeColumns = {
    threads: false,
    comments: false,
    add: 0,
    del: 0,
    status: false,
    viewed: false,
  };
  for (const row of rows) {
    if (row.kind === 'file') {
      const b = badges?.get(row.file.path);
      if (b?.threads) cols.threads = true;
      if (b?.comments) cols.comments = true;
      if (b?.viewed !== undefined) cols.viewed = true;
      const c = row.file.change;
      if (!c) continue;
      cols.status = true;
      cols.add = Math.max(cols.add, signed(c.additions));
      cols.del = Math.max(cols.del, signed(c.deletions));
    } else if (row.kind === 'folder') {
      if (row.folder.untracked) cols.status = true;
      if (row.open) continue;
      const t = row.folder.tally;
      cols.add = Math.max(cols.add, signed(t.add + t.untrackedAdd));
      cols.del = Math.max(cols.del, signed(t.del));
    }
  }
  return cols;
}

/** The columns, left to right, in the order a row draws them. */
const COLUMN_ORDER = ['threads', 'comments', 'add', 'del', 'status', 'viewed'] as const;

/** Which of a row's columns hold a value. */
export type FilledColumns = Record<(typeof COLUMN_ORDER)[number], boolean>;

/** The tree's columns as one row draws them: those after its first value
 *  keep their width, so values line up down the tree; the blank ones before
 *  it are dropped, so its name runs up to that value. Null: the row has no
 *  values (an open folder, an unchanged file) and its name takes the row. */
export function rowColumns(cols: TreeColumns, filled: FilledColumns): TreeColumns | null {
  const first = COLUMN_ORDER.findIndex((c) => filled[c] && cols[c]);
  if (first < 0) return null;
  const out = { ...cols };
  for (const c of COLUMN_ORDER.slice(0, first)) {
    if (c === 'add' || c === 'del') out[c] = 0;
    else out[c] = false;
  }
  return out;
}

// ── Keys ─────────────────────────────────────────────────────

/** A row as the shared tree's keyboard sees it (`ui/treeNav`): a section's
 *  header sits outside the levels, a note is passed over, a folder is a branch. */
export function treeNode(row: TreeRow): TreeNode {
  switch (row.kind) {
    case 'section':
      return { key: row.key, depth: -1, focusable: false };
    case 'note':
      return { key: row.key, depth: row.depth, focusable: false };
    case 'folder':
      return { key: row.key, depth: row.depth, open: row.open, focusable: true };
    case 'file':
      return { key: row.key, depth: row.depth, focusable: true };
  }
}

/** What a key does on the focused file-tree row: `ui/treeNav`'s `treeKey`
 *  over these rows (headers and notes skipped; Right opens a folder, Left
 *  closes it or steps out to its folder). */
export function treeKey(rows: readonly TreeRow[], index: number, key: string): TreeKeyAction {
  return navKey(rows.map(treeNode), index, key);
}
