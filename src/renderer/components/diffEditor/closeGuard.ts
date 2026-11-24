/*
 * Closing the editor drops its unsaved edits, so every way of closing it (the
 * sidebar's close button, Escape, the keybinding, the modal's own close) asks
 * first. Those live outside the editor, which is lazy-loaded with Monaco; this
 * module stays Monaco-free so they can call it. A mounted editor registers the
 * check.
 */

type Guard = () => boolean | Promise<boolean>;

const guards = new Set<Guard>();

/** Register a check that returns false to keep the editor open; returns the
 *  unregister. */
export function addCloseGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** True when every mounted editor agrees to close (asking about unsaved edits). */
export async function mayCloseEditor(): Promise<boolean> {
  for (const guard of guards) if (!(await guard())) return false;
  return true;
}
