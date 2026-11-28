import {
  isSessionPermissionMode,
  STOP_FAILURE_ERRORS,
  type ActivityError,
  type SessionPermissionMode,
} from '@shared/types';
import type { NotificationType } from '../claudeContract/hookSchemas';

/**
 * Why a StopFailure ended the turn. Claude Code names the type in `error`
 * (one of STOP_FAILURE_ERRORS; a value newer than Dash counts as `unknown`).
 * The type's label says enough, so the rendered error text
 * (`last_assistant_message`, else `error_details`) rides along only for an
 * unknown one.
 */
export function stopFailureError(payload: Record<string, unknown>): ActivityError {
  const type = STOP_FAILURE_ERRORS.find((e) => e === payload.error) ?? 'unknown';
  if (type !== 'unknown') return { type };
  const text = stopFailureText(payload);
  return text ? { type, message: text } : { type };
}

/** The error text a StopFailure shows: `last_assistant_message`, else `error_details`. */
export function stopFailureText(payload: Record<string, unknown>): string | undefined {
  const { error_details: details, last_assistant_message: rendered } = payload;
  return [rendered, details].find((t): t is string => typeof t === 'string' && t !== '');
}

/**
 * What each Notification `notification_type` Dash registers means for the
 * task (H2; the types are listed at code.claude.com/docs/en/hooks):
 * `needs` it waits on the user, `answered` a wait ended and the work goes
 * on, `idle` it has sat at the prompt for a minute, `resumed` Claude Code
 * continued it on its own after a usage limit (auto-resume), `noted` nothing
 * for the task: registered only for the limit evidence log. Types missing
 * here are about other sessions (agent view) or ask nothing of the user.
 *
 * The quota types (2.1.234+): `_fired` resumes the task; `_stale` (the reset
 * passed while the computer slept) waits on Enter; `_disabled` (Claude Code
 * stopped waiting: auto-continue off, a reset over a day away, the limit hit
 * again) leaves the task red with its error, the limit already announced
 * [provisional].
 */
export const WAIT_NOTIFICATIONS: Readonly<
  Partial<Record<NotificationType, 'needs' | 'answered' | 'idle' | 'resumed' | 'noted'>>
> = {
  permission_prompt: 'needs',
  elicitation_dialog: 'needs',
  elicitation_url_dialog: 'needs',
  quota_auto_resume_stale: 'needs',
  elicitation_response: 'answered',
  elicitation_complete: 'answered',
  idle_prompt: 'idle',
  quota_auto_resume_fired: 'resumed',
  quota_auto_resume_disabled: 'noted',
};

/**
 * Notifications that say the account's usage limit is over: auto-resume
 * fired (the limit reset, or usage came back), or the reset passed while the
 * computer slept (`_stale`, which then waits on Enter).
 */
export const LIMIT_OVER_NOTIFICATIONS: ReadonlySet<NotificationType> = new Set([
  'quota_auto_resume_fired',
  'quota_auto_resume_stale',
]);

/** What a wait on the user waits for, for analytics (`wait_ended.kind`). */
export type WaitKind = 'permission' | 'question' | 'elicitation' | 'quota';

/** The wait kind of each `needs` notification in WAIT_NOTIFICATIONS. */
export const NOTIFICATION_WAIT_KINDS: Readonly<Partial<Record<NotificationType, WaitKind>>> = {
  permission_prompt: 'permission',
  elicitation_dialog: 'elicitation',
  elicitation_url_dialog: 'elicitation',
  quota_auto_resume_stale: 'quota',
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
 * The session's permission mode from a hook payload (`permission_mode`, a
 * common input field), or undefined. A subagent's hooks are skipped: its
 * frontmatter can give it a mode of its own, which isn't the session's.
 */
export function sessionPermissionMode(
  payload: Record<string, unknown>,
): SessionPermissionMode | undefined {
  if (isSubagentHook(payload)) return undefined;
  const mode = payload.permission_mode;
  return isSessionPermissionMode(mode) ? mode : undefined;
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
 * under a project that is itself a task, that is the root task's. Its URL
 * names the session's own task once the session has TASK_ID_ENV, else the
 * task that wrote the file. The payload names the session's own folder
 * (`workspace.project_dir`, else `cwd`): its only task owns the report;
 * with none there, or several (tasks with no branch share a folder), the
 * URL's id does.
 */
export function statusLineTaskId(
  urlPtyId: string,
  payload: Record<string, unknown>,
  taskIdsAtPath: (dir: string) => string[],
): string {
  const workspace = payload.workspace as Record<string, unknown> | undefined;
  const dir =
    typeof workspace?.project_dir === 'string'
      ? workspace.project_dir
      : typeof payload.cwd === 'string'
        ? payload.cwd
        : undefined;
  const ids = dir ? taskIdsAtPath(dir) : [];
  return ids.length === 1 ? ids[0]! : urlPtyId;
}
