export interface LineRange {
  start: number;
  end: number;
}

/** A reference to paste into a prompt or chat: `src/a.ts:12` or `src/a.ts:12-18`. */
export function fileRef(filePath: string, lines: LineRange | null): string {
  if (!lines) return filePath;
  const lo = Math.min(lines.start, lines.end);
  const hi = Math.max(lines.start, lines.end);
  return lo === hi ? `${filePath}:${lo}` : `${filePath}:${lo}-${hi}`;
}

/**
 * A tab's file outside the task's worktree, which a tab names by its absolute
 * path (worktree files by their repo-relative one): a file of Claude Code's
 * own folders for the task, its scratchpad or its project's memory (A10).
 * It opens as a plain file: the working view, no git, no comments.
 */
export function isOutsideWorktree(filePath: string): boolean {
  return filePath.startsWith('/');
}

/** `filePath` resolved against the repo root `cwd`; an outside file's is its own. */
export function absolutePath(cwd: string, filePath: string): string {
  if (isOutsideWorktree(filePath)) return filePath;
  return `${cwd.replace(/\/+$/, '')}/${filePath}`;
}
