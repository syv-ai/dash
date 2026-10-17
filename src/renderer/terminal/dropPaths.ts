/**
 * Text to paste for files dropped on a terminal, written the way Terminal.app
 * writes a drop: POSIX paths backslash-escaped (quotes would stop Claude Code
 * recognising an image path), Windows paths double-quoted when they need it.
 * The trailing space separates the paths from what is typed next; it must be
 * part of the paste itself, because Claude Code drops a paste when any byte
 * follows the paste's end marker in the same write.
 */

const POSIX_SPECIAL = /[ \t!"#$&'()*;<>?[\\\]^`{|}~]/g;

export function escapeDroppedPath(filePath: string, platform: string): string {
  if (platform === 'win32') return /[\s&()^,;=!'"]/.test(filePath) ? `"${filePath}"` : filePath;
  return filePath.replace(POSIX_SPECIAL, (c) => `\\${c}`);
}

/** The paste for a drop, or null when no dropped item had a path. */
export function droppedPathsText(paths: string[], platform: string): string | null {
  const usable = paths.filter((p) => p.length > 0);
  if (usable.length === 0) return null;
  return usable.map((p) => escapeDroppedPath(p, platform)).join(' ') + ' ';
}
