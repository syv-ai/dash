/**
 * Which task does a hook event belong to?
 *
 * The `?ptyId=` baked into each worktree's settings.local.json is not enough:
 * Claude Code also loads the project root's settings.local.json inside every
 * worktree session under it, so the root task's hooks (and, for the single
 * `statusLine` slot, possibly its status line) fire there with the root
 * task's id. The event's own directory is the reliable signal.
 *
 * Pure (no DB, no electron) so it can be tested directly.
 */

export interface TaskPathRef {
  id: string;
  path: string;
}

/** Directory a hook payload says it ran in. statusLine payloads carry the
 *  session's stable `workspace.project_dir`; other hooks only carry `cwd`. */
export function payloadDirectory(payload: Record<string, unknown>): string | null {
  const ws = payload.workspace;
  if (ws && typeof ws === 'object') {
    const w = ws as Record<string, unknown>;
    if (typeof w.project_dir === 'string' && w.project_dir) return w.project_dir;
  }
  return typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : null;
}

function trimSlash(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}

/** Marker of Claude Code's own nested worktrees (subagent isolation). */
const NESTED_WORKTREE = /^[\\/]\.claude[\\/]worktrees[\\/]/;

/**
 * Resolve the owning task id.
 *
 * - Longest task path that is the directory or an ancestor of it wins, so a
 *   session in `<project>/.claude/worktrees/x` is task x, not the project's
 *   root task.
 * - A directory nested under a task but inside a `.claude/worktrees/` folder
 *   that is not itself a task (a subagent's worktree) belongs to no task:
 *   returns null rather than crediting the ancestor.
 * - No directory in the payload, or none that lies under a task: the query
 *   id the settings file carried.
 */
export function resolveHookTaskId(
  queryId: string,
  payload: Record<string, unknown>,
  taskPaths: readonly TaskPathRef[],
): string | null {
  const dirRaw = payloadDirectory(payload);
  if (!dirRaw) return queryId;
  const dir = trimSlash(dirRaw);

  let best: TaskPathRef | null = null;
  let bestPath = '';
  for (const t of taskPaths) {
    const tp = trimSlash(t.path);
    if (dir !== tp && !dir.startsWith(tp + '/') && !dir.startsWith(tp + '\\')) continue;
    if (!best || tp.length > bestPath.length) {
      best = t;
      bestPath = tp;
    }
  }
  if (!best) return queryId;

  const rest = dir.slice(bestPath.length);
  if (rest && NESTED_WORKTREE.test(rest)) return null;
  return best.id;
}
