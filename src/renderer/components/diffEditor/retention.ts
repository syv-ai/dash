import { useEditors } from '../../stores/editorsStore';

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

/**
 * The parked holders to release as editors close: those whose folder had an
 * editor `before` and has none `after` (closed, or its task archived or
 * deleted while in the background).
 */
export function parkedToRelease(
  parked: ReadonlyMap<string, string>,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const out: string[] = [];
  for (const [holder, cwd] of parked) if (cwd in before && !(cwd in after)) out.push(holder);
  return out;
}

/** Unmounted editors still holding unsaved files: holder → its folder. */
const parked = new Map<string, string>();
let watching = false;

/**
 * Note that `holder` (an unmounted editor of `cwd`) keeps files alive, and
 * from then on release it, through `release`, once `cwd`'s editor closes.
 * Mounting again (`unpark`) hands its files back to the live editor.
 */
export function park(holder: string, cwd: string, release: (holder: string) => void): void {
  parked.set(holder, cwd);
  if (watching) return;
  watching = true;
  useEditors.subscribe((s, prev) => {
    for (const h of parkedToRelease(parked, prev.byCwd, s.byCwd)) {
      parked.delete(h);
      release(h);
    }
  });
}

export function unpark(holder: string): void {
  parked.delete(holder);
}
