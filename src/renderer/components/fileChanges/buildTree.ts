import type { FileChange, FileChangeStatus } from '../../../shared/types';

export interface NodeAggregate {
  count: number;
  /** Additions from tracked changes (modified/added/etc.), excluding untracked. */
  add: number;
  /** Deletions from tracked changes. */
  del: number;
  /** Total lines across untracked files (file sizes, not edits). */
  untrackedAdd: number;
  statuses: Set<FileChangeStatus>;
  status: FileChangeStatus | 'mixed';
  stagedCount: number;
  stageState: true | false | 'mixed';
}

export interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  files: FileChange[];
  agg: NodeAggregate;
}

function makeNode(name: string, path: string): TreeNode {
  return {
    name,
    path,
    children: new Map(),
    files: [],
    agg: {
      count: 0,
      add: 0,
      del: 0,
      untrackedAdd: 0,
      statuses: new Set(),
      status: 'mixed',
      stagedCount: 0,
      stageState: false,
    },
  };
}

/** Every changed file in this subtree (this node's files + descendants'). */
export function collectFiles(node: TreeNode): FileChange[] {
  const out = [...node.files];
  for (const child of node.children.values()) out.push(...collectFiles(child));
  return out;
}

/** `path` relative to `base` ('a/b/c' under 'a' → 'b/c'), or null if not under it. */
function relativeUnder(base: string, path: string): string | null {
  if (base === '') return path;
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
}

/** The source directory a renamed file came from, given its suffix relative to
 *  the folder ('old/dir/x.py' with rel 'x.py' → 'old/dir'), or null on mismatch. */
function renameSourceDir(oldPath: string, rel: string): string | null {
  if (oldPath === rel) return '';
  return oldPath.endsWith(`/${rel}`) ? oldPath.slice(0, oldPath.length - rel.length - 1) : null;
}

/**
 * Whether the folder ITSELF was renamed/moved — true only when every changed
 * file in its subtree is a git rename and they all moved from a single common
 * source directory other than this folder's path. A folder that merely contains
 * modified/added/untracked files (or a file renamed in place) is NOT itself
 * changed, so it renders neutral rather than inheriting a child's tint.
 */
function isRenamedFolder(node: TreeNode): boolean {
  const files = collectFiles(node);
  if (files.length === 0) return false;
  let source: string | null = null;
  for (const file of files) {
    if (file.status !== 'renamed' || !file.oldPath) return false;
    const rel = relativeUnder(node.path, file.path);
    if (rel === null) return false;
    const src = renameSourceDir(file.oldPath, rel);
    if (src === null) return false;
    if (source === null) source = src;
    else if (source !== src) return false;
  }
  return source !== null && source !== node.path;
}

function aggregate(node: TreeNode): void {
  let count = node.files.length;
  let add = 0;
  let del = 0;
  let untrackedAdd = 0;
  let stagedCount = 0;
  const statuses = new Set<FileChangeStatus>();

  for (const file of node.files) {
    statuses.add(file.status);
    if (file.staged) stagedCount++;
    if (file.status === 'untracked') {
      untrackedAdd += file.additions;
    } else {
      add += file.additions;
      del += file.deletions;
    }
  }

  for (const child of node.children.values()) {
    aggregate(child);
    count += child.agg.count;
    add += child.agg.add;
    del += child.agg.del;
    untrackedAdd += child.agg.untrackedAdd;
    stagedCount += child.agg.stagedCount;
    for (const s of child.agg.statuses) statuses.add(s);
  }

  node.agg.count = count;
  node.agg.add = add;
  node.agg.del = del;
  node.agg.untrackedAdd = untrackedAdd;
  node.agg.stagedCount = stagedCount;
  node.agg.statuses = statuses;
  node.agg.status = isRenamedFolder(node) ? 'renamed' : 'mixed';
  node.agg.stageState = stagedCount === 0 ? false : stagedCount === count ? true : 'mixed';
}

export function compressedDisplay(node: TreeNode): { display: string; terminal: TreeNode } {
  let cur = node;
  let display = node.name;
  while (cur.children.size === 1 && cur.files.length === 0) {
    const onlyChild = [...cur.children.values()][0]!;
    display = `${display}/${onlyChild.name}`;
    cur = onlyChild;
  }
  return { display, terminal: cur };
}

export function buildTree(files: FileChange[]): TreeNode {
  const root = makeNode('', '');
  for (const file of files) {
    const segments = file.path.split('/');
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      let child = node.children.get(seg);
      if (!child) {
        const childPath = node.path ? `${node.path}/${seg}` : seg;
        child = makeNode(seg, childPath);
        node.children.set(seg, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  aggregate(root);
  return root;
}
