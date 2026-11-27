/**
 * The extra folders a task's session may read and edit (`claude --add-dir`).
 * Shared by the folder fields, the project default and the dispatch.
 */

/** A full path on any platform: `/…`, `C:\…` or `\\server\…`. */
export function isAbsoluteFolder(folder: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(folder);
}

/** The list as it is saved and passed: trimmed, blanks dropped, each once. */
export function normalizeAddDirs(folders: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of folders ?? []) {
    const folder = raw.trim();
    if (folder && !out.includes(folder)) out.push(folder);
  }
  return out;
}

/** Why a folder can't be passed, or null. Claude Code checks the rest (that it exists). */
export function addDirProblem(folder: string): string | null {
  const f = folder.trim();
  if (!f) return null;
  if (!isAbsoluteFolder(f)) return `${f} isn't a full path; ~ and relative paths aren't expanded.`;
  return null;
}

/** Whether two lists name the same folders in the same order, once normalized. */
export function sameAddDirs(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const x = normalizeAddDirs(a);
  const y = normalizeAddDirs(b);
  return x.length === y.length && x.every((f, i) => f === y[i]);
}
