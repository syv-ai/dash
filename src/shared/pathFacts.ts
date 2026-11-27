/** What main found at a path typed into the New Project dialog (`project:inspectPath`). */
export interface PathFacts {
  /** The input these facts answer, as typed (trimmed); the renderer ignores stale ones. */
  input: string;
  /** Absolute, `~` expanded, normalised. */
  path: string;
  exists: boolean;
  isDirectory: boolean;
  /** It has a `.git` (as `GitService.detectRepo` decides). */
  isGitRepo: boolean;
  parentExists: boolean;
  /** The Dash project the path is, is inside, or is a worktree of. */
  project: {
    id: string;
    name: string;
    relation: 'same' | 'inside' | 'worktree';
    archived: boolean;
  } | null;
}
