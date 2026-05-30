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

// Precedence used when a folder has mixed-status descendants. The most
// "interesting" status wins so ancestors stay tinted with the change type
// rather than collapsing to neutral grey. Untracked sits last so a folder
// of new files alone still reads as untracked, but a folder mixing
// untracked with real modifications reads as modified.
const STATUS_PRIORITY: FileChangeStatus[] = [
  'conflicted',
  'modified',
  'deleted',
  'renamed',
  'added',
  'untracked',
];

function dominantStatus(statuses: Set<FileChangeStatus>): FileChangeStatus | 'mixed' {
  if (statuses.size === 0) return 'mixed';
  if (statuses.size === 1) return [...statuses][0];
  for (const s of STATUS_PRIORITY) {
    if (statuses.has(s)) return s;
  }
  return 'mixed';
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
  node.agg.status = dominantStatus(statuses);
  node.agg.stageState = stagedCount === 0 ? false : stagedCount === count ? true : 'mixed';
}

export function compressedDisplay(node: TreeNode): { display: string; terminal: TreeNode } {
  let cur = node;
  let display = node.name;
  while (cur.children.size === 1 && cur.files.length === 0) {
    const onlyChild = [...cur.children.values()][0];
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
      const seg = segments[i];
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
