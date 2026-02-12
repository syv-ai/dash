export interface Project {
  id: string;
  name: string;
  path: string;
  gitRemote: string | null;
  gitBranch: string | null;
  baseRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: string;
  useWorktree: boolean;
  autoApprove: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  taskId: string;
  title: string;
  isActive: boolean;
  isMain: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface WorktreeInfo {
  id: string;
  name: string;
  branch: string;
  path: string;
  projectId: string;
  status: 'active' | 'error';
  createdAt: string;
}

export interface ReserveWorktree {
  id: string;
  path: string;
  branch: string;
  projectId: string;
  projectPath: string;
  baseRef: string;
  createdAt: string;
}

export interface PtyOptions {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  autoApprove?: boolean;
  resume?: boolean;
}

export interface TerminalSnapshot {
  version: 1;
  createdAt: string;
  cols: number;
  rows: number;
  data: string;
}

// ── Branch Types ─────────────────────────────────────────────

export interface BranchInfo {
  name: string; // "main", "develop"
  ref: string; // "origin/main", "origin/develop"
  shortHash: string; // "a1b2c3d"
  relativeDate: string; // "2 days ago"
}

// ── Git Types ────────────────────────────────────────────────

export type FileChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  staged: boolean;
  additions: number;
  deletions: number;
  oldPath?: string; // For renames
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
}

export interface DiffResult {
  filePath: string;
  hunks: DiffHunk[];
  isBinary: boolean;
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}
