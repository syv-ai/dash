/*
 * Closing the editor drops its unsaved edits, so every way of closing it (the
 * sidebar's close button, Escape, the keybinding, the modal's ×) asks first.
 * Those live outside the editor, which is lazy-loaded with Monaco; this module
 * stays Monaco-free so they can call it. A mounted editor registers the check.
 */

type Guard = () => boolean;

const guards = new Set<Guard>();

/** Register a check that returns false to keep the editor open; returns the
 *  unregister. */
export function addCloseGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** True when every mounted editor agrees to close (asking about unsaved edits). */
export function mayCloseEditor(): boolean {
  for (const guard of guards) if (!guard()) return false;
  return true;
}
