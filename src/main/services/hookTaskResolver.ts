/**
 * Which task does a hook event belong to, and should it be handled?
 *
 * The `?ptyId=` baked into each worktree's settings.local.json is not enough:
 * Claude Code also loads the project root's settings.local.json inside every
 * worktree session under it, so a worktree session POSTs each event twice —
 * once with its own task id and once with the root task's id.
 *
 * The payload's `session_id` is the reliable signal: Dash records it per task
 * at dispatch (`tasks.session_id`) and, unlike `cwd`, it does not change when
 * the agent `cd`s or enters a nested worktree.
 *
 * Pure (no DB, no electron) so it can be tested directly.
 */

export interface TaskSessionRef {
  id: string;
  sessionId: string | null;
}

export interface HookRouting {
  taskId: string;
  /** The same event also arrives under the owning task's own id; handling
   *  this copy as well would double every notification. */
  duplicate: boolean;
}

/**
 * - The payload's session belongs to a task: that task owns the event. Only
 *   the copy delivered under its own id is handled; copies carrying another
 *   task's id (a leaked root settings file) are duplicates.
 * - No session id, or one no task recorded: trust the URL id. Never drop.
 */
export function resolveHookRouting(
  queryId: string,
  payload: Record<string, unknown>,
  tasks: readonly TaskSessionRef[],
): HookRouting {
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const owner = sessionId ? tasks.find((t) => t.sessionId === sessionId) : undefined;
  if (!owner) return { taskId: queryId, duplicate: false };
  return { taskId: owner.id, duplicate: owner.id !== queryId };
}
