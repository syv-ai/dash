/**
 * True for a hook fired inside a subagent: Claude Code sets `agent_id` only
 * there. A subagent's tool calls are not the task's own turn, so they don't
 * drive the main turn's state or tool label; SubagentStart/SubagentStop
 * track the subagents themselves (S3).
 */
export function isSubagentHook(payload: Record<string, unknown>): boolean {
  return typeof payload.agent_id === 'string' && payload.agent_id !== '';
}

/**
 * The background subagents a Stop or SubagentStop hook lists as running
 * (`background_tasks`, Claude Code 2.1.145+), or undefined when the payload
 * has no list. Shells, monitors and other background work don't count: a
 * dev server left running isn't the agent working.
 */
export function runningSubagentIds(payload: Record<string, unknown>): string[] | undefined {
  const tasks = payload.background_tasks;
  if (!Array.isArray(tasks)) return undefined;
  return tasks.flatMap((t: unknown) => {
    const task = t as Record<string, unknown> | null;
    return task?.type === 'subagent' && task.status === 'running' && typeof task.id === 'string'
      ? [task.id]
      : [];
  });
}

/**
 * The subagent a SubagentStart/SubagentStop hook is about. Claude Code's own
 * internal agents (prompt suggestions, `/btw`) fire SubagentStop with an
 * empty `agent_type` in a session run without `--agent`; they aren't the
 * task's work, so they get no id.
 */
export function subagentId(payload: Record<string, unknown>): string | undefined {
  const { agent_id: id, agent_type: type } = payload;
  return typeof id === 'string' && id !== '' && typeof type === 'string' && type !== ''
    ? id
    : undefined;
}

/**
 * A turn Claude Code started itself with a background subagent's report
 * (UserPromptSubmit also fires for those), not a prompt the user typed.
 */
export function isSelfStartedPrompt(payload: Record<string, unknown>): boolean {
  return typeof payload.prompt === 'string' && payload.prompt.startsWith('<task-notification>');
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
