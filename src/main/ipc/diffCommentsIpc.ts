/** Returns the ids of comment rows whose file_path is not in `existing`.
 *  Pure so we can test it without touching SQLite. Used by
 *  `diffComments:pruneForTask` to hard-delete dropped paths between sessions. */
export function computeOrphans(
  rows: ReadonlyArray<{ id: string; file_path: string }>,
  existing: ReadonlySet<string>,
): string[] {
  return rows.filter((r) => !existing.has(r.file_path)).map((r) => r.id);
}
