import { broadcast } from '../utils/broadcast';

/**
 * "The project list changed" in main (a project the control API added), for
 * the renderer (`projects:changed`), which reloads its list. Like
 * `tasks:changed` (taskEvents.ts); the renderer's own project edits reload
 * themselves.
 */
export function broadcastProjectsChanged(): void {
  broadcast('projects:changed');
}
