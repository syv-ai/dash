import { z } from 'zod';
import { SESSION_PERMISSION_MODES, STOP_FAILURE_ERRORS } from '@shared/types';
import { checkShape } from './check';
import type { DriftFinding, DriftSource } from './types';

/**
 * What Dash expects of every hook payload it registers for, per event, from
 * the hooks reference (code.claude.com/docs/en/hooks, fetched 2026-11-26 for
 * Claude Code 2.1.332) and the live payload logs of the S2/S3/H2/H3 runs.
 * Every documented field is modelled, optional where the docs say so, so a
 * documented field never reports; anything else reports `unexpected-field`.
 * Free-form values (tool input and output, MCP schemas, permission
 * suggestions) are not walked: they are content, and their shape is the
 * tool's, not Claude Code's.
 */

// ── Enums (documented values) ──────────────────────────────

/** Notification `notification_type` (hooks reference, Notification matcher table). */
export const NOTIFICATION_TYPES = [
  'permission_prompt',
  'idle_prompt',
  'auth_success',
  'auth_storage_failure',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'elicitation_complete',
  'elicitation_response',
  'agent_needs_input',
  'agent_completed',
  'quota_auto_resume_fired',
  'quota_auto_resume_stale',
  'quota_auto_resume_disabled',
  'plugin_notification',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** `background_tasks[].type`: the documented labels ("falls back to the raw discriminant"). */
export const BACKGROUND_TASK_TYPES = [
  'shell',
  'subagent',
  'monitor',
  'workflow',
  'teammate',
  'cloud session',
  'MCP task',
] as const;

/**
 * `background_tasks[].status`: undocumented ("current task status"). Only
 * `running` is seen live; the rest are Claude Code's task states as far as
 * Dash knows them [provisional, C5]. Dash counts `running` only.
 */
export const BACKGROUND_TASK_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'killed',
] as const;

const str = z.string();
const opt = <T extends z.ZodType>(t: T) => t.optional();

const effort = z.strictObject({ level: z.enum(EFFORT_LEVELS) });

/** Fields every event may carry (hooks reference, "Common input fields"). */
const common = {
  session_id: str,
  transcript_path: str,
  cwd: str,
  hook_event_name: str,
  prompt_id: opt(str),
  scratchpad_dir: opt(str),
  permission_mode: opt(z.enum(SESSION_PERMISSION_MODES)),
  effort: opt(effort),
  agent_id: opt(str),
  agent_type: opt(str),
};

const event = <S extends z.ZodRawShape>(shape: S) => z.strictObject({ ...common, ...shape });

const mcpServer = z.strictObject({ name: str, source: str });

const backgroundTask = z.strictObject({
  id: str,
  type: z.enum(BACKGROUND_TASK_TYPES),
  status: z.enum(BACKGROUND_TASK_STATUSES),
  description: opt(str),
  command: opt(str),
  agent_type: opt(str),
  server: opt(str),
  tool: opt(str),
  name: opt(str),
});

const sessionCron = z.strictObject({
  id: str,
  schedule: str,
  recurring: z.boolean(),
  prompt: str,
});

const stopFields = {
  stop_hook_active: z.boolean(),
  last_assistant_message: opt(str),
  background_tasks: opt(z.array(backgroundTask)),
  session_crons: opt(z.array(sessionCron)),
};

const toolFields = {
  tool_name: str,
  tool_input: z.record(str, z.unknown()),
  mcp_server: opt(mcpServer),
};

const compactTrigger = z.enum(['manual', 'auto']);

/** One schema per event Dash registers (ptyHookSettings). */
export const HOOK_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  SessionStart: event({
    source: z.enum(['startup', 'resume', 'clear', 'compact', 'fork']),
    model: opt(str),
    session_title: opt(str),
    seconds_since_last_response: opt(z.number()),
    context_tokens: opt(z.number()),
    prompt_cache_likely_expired: opt(z.boolean()),
    estimated_cache_write_usd: opt(z.number()),
  }),
  UserPromptSubmit: event({ prompt: str, session_title: opt(str) }),
  PreToolUse: event({ ...toolFields, tool_use_id: str }),
  PermissionRequest: event({ ...toolFields, permission_suggestions: opt(z.array(z.unknown())) }),
  PostToolUse: event({
    ...toolFields,
    tool_use_id: str,
    tool_response: z.unknown(),
    duration_ms: opt(z.number()),
  }),
  Notification: event({
    message: str,
    title: opt(str),
    notification_type: z.enum(NOTIFICATION_TYPES),
  }),
  SubagentStart: event({ agent_id: str, agent_type: str }),
  SubagentStop: event({
    ...stopFields,
    agent_id: str,
    agent_type: str,
    agent_transcript_path: str,
  }),
  Stop: event(stopFields),
  StopFailure: event({
    error: z.enum(STOP_FAILURE_ERRORS),
    error_details: opt(str),
    last_assistant_message: opt(str),
  }),
  PreCompact: event({ trigger: compactTrigger, custom_instructions: str.nullable() }),
  PostCompact: event({ trigger: compactTrigger, compact_summary: str }),
  SessionEnd: event({
    reason: z.enum(['clear', 'resume', 'logout', 'prompt_input_exit', 'other']),
  }),
  Elicitation: event({
    mcp_server_name: str,
    message: str,
    mode: opt(z.enum(['form', 'url'])),
    url: opt(str),
    elicitation_id: opt(str),
    requested_schema: opt(z.unknown()),
  }),
  ElicitationResult: event({
    mcp_server_name: str,
    action: z.enum(['accept', 'decline', 'cancel']),
    mode: opt(z.enum(['form', 'url'])),
    elicitation_id: opt(str),
    content: opt(z.unknown()),
  }),
};

/** The event each HookServer endpoint is registered for (ptyHookSettings). */
export const ENDPOINT_EVENTS: Readonly<Record<string, string>> = {
  '/hook/stop': 'Stop',
  '/hook/busy': 'UserPromptSubmit',
  '/hook/notification': 'Notification',
  '/hook/permission-request': 'PermissionRequest',
  '/hook/elicitation': 'Elicitation',
  '/hook/elicitation-result': 'ElicitationResult',
  '/hook/tool-start': 'PreToolUse',
  '/hook/tool-end': 'PostToolUse',
  '/hook/stop-failure': 'StopFailure',
  '/hook/subagent-start': 'SubagentStart',
  '/hook/subagent-stop': 'SubagentStop',
  '/hook/compact-start': 'PreCompact',
  '/hook/compact-end': 'PostCompact',
  '/hook/session-end': 'SessionEnd',
  '/hook/session-start': 'SessionStart',
  '/hook/inbox': 'SessionStart',
};

export interface SourcedFindings {
  source: DriftSource;
  findings: DriftFinding[];
}

/**
 * The drift in one hook payload. The payload's own `hook_event_name` picks
 * the schema; without one, the endpoint's event does (and the missing name
 * reports). An event Dash has no schema for reports once, as itself.
 */
export function checkHookPayload(payload: unknown, endpoint?: string): SourcedFindings {
  const named = (payload as { hook_event_name?: unknown } | null)?.hook_event_name;
  const eventName = typeof named === 'string' ? named : endpoint && ENDPOINT_EVENTS[endpoint];
  if (!eventName) {
    return { source: 'hook', findings: [{ kind: 'missing-field', path: 'hook_event_name' }] };
  }
  const schema = HOOK_SCHEMAS[eventName];
  if (!schema) {
    const value = /^[A-Za-z]{1,48}$/.test(eventName) ? eventName : undefined;
    return {
      source: 'hook',
      findings: [{ kind: 'unknown-event', path: 'hook_event_name', ...(value ? { value } : {}) }],
    };
  }
  return { source: `hook:${eventName}`, findings: checkShape(schema, payload) };
}
