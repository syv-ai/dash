import { STOP_FAILURE_ERRORS, type ActivityError } from '@shared/types';

/**
 * Why a StopFailure ended the turn. Claude Code names the type in `error`
 * (one of STOP_FAILURE_ERRORS; a value newer than Dash counts as `unknown`).
 * The type's label says enough, so the rendered error text
 * (`last_assistant_message`, else `error_details`) rides along only for an
 * unknown one.
 */
export function stopFailureError(payload: Record<string, unknown>): ActivityError {
  const { error, error_details: details, last_assistant_message: rendered } = payload;
  const type = STOP_FAILURE_ERRORS.find((e) => e === error) ?? 'unknown';
  if (type !== 'unknown') return { type };
  const text = [rendered, details].find((t): t is string => typeof t === 'string' && t !== '');
  return text ? { type, message: text } : { type };
}

/**
 * What each Notification `notification_type` Dash registers means for the
 * task (H2; the types are listed at code.claude.com/docs/en/hooks):
 * `needs` it waits on the user, `answered` a wait ended and the work goes
 * on, `idle` it has sat at the prompt for a minute. Types missing here are
 * about other sessions (agent view) or ask nothing of the user.
 */
export const WAIT_NOTIFICATIONS: Readonly<Record<string, 'needs' | 'answered' | 'idle'>> = {
  permission_prompt: 'needs',
  elicitation_dialog: 'needs',
  elicitation_url_dialog: 'needs',
  quota_auto_resume_stale: 'needs',
  elicitation_response: 'answered',
  elicitation_complete: 'answered',
  idle_prompt: 'idle',
};

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
