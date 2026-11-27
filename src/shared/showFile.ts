/** Lines of a file, 1-based and inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * `dashctl show`: a file for a task's editor to show (main's `app:showFile`).
 * `path` is as the editor names it: repo-relative in the worktree, absolute
 * in a folder outside it.
 */
export interface ShowFileRequest {
  taskId: string;
  path: string;
  /** Scroll to these lines and highlight them, in the source. */
  lines: LineRange | null;
  /** A Markdown or HTML file in its source, not rendered. */
  source: boolean;
}

/** `--lines`: one line (`42`) or a range (`10-20`); null when it is neither. */
export function parseLines(value: string): LineRange | null {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(value);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  return start >= 1 && end >= start ? { start, end } : null;
}
