/**
 * The open tabs' files (absolute paths) an editor keeps alive once it
 * unmounts. Closed, none: closing agreed to drop its unsaved edits.
 * Unmounted while still open (its task was switched away from), the unsaved
 * ones, so switching back finds them; a clean file reloads from disk.
 */
export function retainedOnUnmount(
  openFiles: readonly string[],
  closed: boolean,
  isDirty: (absPath: string) => boolean,
): string[] {
  return closed ? [] : openFiles.filter(isDirty);
}
