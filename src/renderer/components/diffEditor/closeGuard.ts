/*
 * Closing the editor drops its unsaved edits, so every way of closing it (the
 * sidebar's close button, Escape, the keybinding) asks
 * first. Those live outside the editor, which is lazy-loaded with Monaco; this
 * module stays Monaco-free so they can call it. A mounted editor registers the
 * check for its task's folder: several can be mounted at once (tasks' editors
 * kept out of sight), and closing one asks only about its own.
 */

type Guard = () => boolean | Promise<boolean>;

const guards = new Map<Guard, string>();

/** Register a check for `cwd`'s editor that returns false to keep it open;
 *  returns the unregister. */
export function addCloseGuard(cwd: string, guard: Guard): () => void {
  guards.set(guard, cwd);
  return () => guards.delete(guard);
}

/** True when `cwd`'s mounted editors agree to close (asking about unsaved edits). */
export async function mayCloseEditor(cwd: string): Promise<boolean> {
  for (const [guard, of] of guards) if (of === cwd && !(await guard())) return false;
  return true;
}
