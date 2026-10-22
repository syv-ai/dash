/**
 * True for a hook fired inside a subagent: Claude Code sets `agent_id` only
 * there. A subagent's tool calls are not the task's own turn — a background
 * subagent keeps working after the main turn ends or is interrupted with
 * Escape, and no Stop hook follows its calls — so they must not drive the
 * task's activity dot.
 */
export function isSubagentHook(payload: Record<string, unknown>): boolean {
  return typeof payload.agent_id === 'string' && payload.agent_id !== '';
}

/**
 * The task a statusLine report belongs to. A session loads the statusLine of
 * every `settings.local.json` above it and runs only one: inside a worktree
 * under a project that is itself a task, that is the root task's, carrying
 * the root's `ptyId`. The payload names the session's own folder
 * (`workspace.project_dir`, else `cwd`), so a task at exactly that path owns
 * the report; otherwise the URL's id does.
 */
export function statusLineTaskId(
  urlPtyId: string,
  payload: Record<string, unknown>,
  taskIdAtPath: (dir: string) => string | undefined,
): string {
  const workspace = payload.workspace as Record<string, unknown> | undefined;
  const dir =
    typeof workspace?.project_dir === 'string'
      ? workspace.project_dir
      : typeof payload.cwd === 'string'
        ? payload.cwd
        : undefined;
  return (dir && taskIdAtPath(dir)) || urlPtyId;
}
