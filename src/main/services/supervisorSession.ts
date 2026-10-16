import { z } from 'zod';
import type {
  ActivityError,
  ActivityState,
  PermissionMode,
  SupervisorSession,
  SupervisorState,
  SupervisorStatus,
  TaskModel,
} from '@shared/types';

/**
 * Pure helpers behind SupervisorService: the `claude --bg` argument policy,
 * parsing of the dispatch output and of `claude agents --json`, and the
 * mapping from a supervisor row to Dash's activity state. Kept free of I/O so
 * the research-preview CLI surface is pinned by unit tests.
 */

// ── Dispatch ────────────────────────────────────────────────

export interface DispatchArgsOptions {
  /** Task name → `--name` (always passed, also on resume: a resume without it
   *  gets an auto-generated name and loses its permission flags on respawn). */
  name: string;
  permissionMode?: PermissionMode;
  /** Model alias (opus|sonnet|haiku|fable). 'default'/undefined → no --model. */
  model?: TaskModel;
  ultracode?: boolean;
  /** Claude session UUID to continue (migrated or re-dispatched task). */
  resumeSessionId?: string | null;
  /** Per-task `--mcp-config` file (tasks with Dash access). */
  mcpConfigPath?: string;
  /** `permissions.allow` rules (the read-only Dash tools), merged into `--settings`. */
  allowTools?: string[];
  /** Optional first prompt, always the last positional, after `--`. */
  prompt?: string;
}

export function buildDispatchArgs(opts: DispatchArgsOptions): string[] {
  // Rule: no variadic flag (`--mcp-config`, `--allowedTools`, …) may come
  // directly before the prompt, or the CLI reads the prompt as one more value
  // and the job starts with none. `--mcp-config` therefore goes right after
  // `--bg`, and `--name` closes it. The prompt itself follows `--`, so one
  // starting with "-" (a markdown bullet) is not parsed as an option.
  const args: string[] = ['--bg'];
  if (opts.mcpConfigPath) {
    args.push('--mcp-config', opts.mcpConfigPath);
  }
  args.push('--name', opts.name);
  if (opts.permissionMode === 'acceptEdits') {
    args.push('--permission-mode', 'acceptEdits');
  } else if (opts.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  }
  if (opts.model && opts.model !== 'default') {
    args.push('--model', opts.model);
  }
  // One `--settings` (single-valued, so its position is free) carries every
  // session setting; a second one would replace the first.
  const settings: { ultracode?: true; permissions?: { allow: string[] } } = {};
  if (opts.ultracode) settings.ultracode = true;
  if (opts.allowTools?.length) settings.permissions = { allow: opts.allowTools };
  if (Object.keys(settings).length > 0) {
    args.push('--settings', JSON.stringify(settings));
  }
  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }
  if (opts.prompt) {
    args.push('--', opts.prompt);
  }
  return args;
}

/**
 * `claude --bg --resume <session> -- <message>`: wake a stopped background
 * session and give it `message` as its next user turn. Nothing else may be
 * passed: with any other flag the CLI starts a copy of the session (it keeps
 * its own saved options), and resuming one that is still running starts a
 * copy too, so the caller stops it first. `--` keeps a message starting with
 * "-" from being read as an option.
 */
export function buildResumeArgs(sessionId: string, message: string): string[] {
  return ['--bg', '--resume', sessionId, '--', message];
}

/**
 * The supervisor's job is busy with a turn or waits for a person, so a message
 * cannot be delivered now (resuming would need a stop, which would cut the
 * turn or the prompt off).
 */
export class SessionNotIdleError extends Error {
  constructor(readonly status: 'busy' | 'waiting') {
    super(`The session is ${status === 'busy' ? 'working' : 'waiting for a person'}`);
    this.name = 'SessionNotIdleError';
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Short job id from the `backgrounded · <id> · <name>` line, or null. */
export function parseDispatchOutput(output: string): string | null {
  const m = output.replace(ANSI_RE, '').match(/^\s*backgrounded\s+·\s+([0-9a-f]{8})\b/m);
  return m ? m[1]! : null;
}

/**
 * The folder `claude --bg` refused because the user never accepted Claude
 * Code's workspace trust prompt for it ("Workspace not trusted. Run `claude`
 * in <root> once…"), or null. Claude keys trust on this root — the main
 * checkout, not a task's worktree.
 */
export function parseUntrustedRoot(output: string): string | null {
  const m = output
    .replace(ANSI_RE, '')
    .match(/Workspace not trusted\.\s+Run `claude` in (.+?) once\b/);
  return m ? m[1]!.trim() : null;
}

/** The CLI prints this when the job could not start; the prompt is then queued
 *  on the job, so the caller must not retry with the same prompt. */
export function isDispatchFailure(output: string): boolean {
  return /couldn't start a background session|could not start a background session/i.test(output);
}

// ── `claude agents --json` ──────────────────────────────────

const STATES: readonly SupervisorState[] = ['working', 'blocked', 'done', 'failed', 'stopped'];
const STATUSES: readonly SupervisorStatus[] = ['busy', 'waiting', 'idle'];

const rowSchema = z.looseObject({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  name: z.string().optional(),
  cwd: z.string(),
  kind: z.string().optional(),
  startedAt: z.number().optional(),
  state: z.string().optional(),
  status: z.string().optional(),
  waitingFor: z.string().optional(),
  pid: z.number().optional(),
  detail: z.string().optional(),
});

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Parse the JSON listing. Rows that fail the loose schema are skipped, unknown
 * enum values become `undefined`, so a field change in the research-preview
 * CLI degrades to "unknown" instead of taking Dash down.
 */
export function parseAgentsJson(stdout: string): SupervisorSession[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const rows: SupervisorSession[] = [];
  for (const item of raw) {
    const parsed = rowSchema.safeParse(item);
    if (!parsed.success) continue;
    const r = parsed.data;
    rows.push({
      id: r.id,
      sessionId: r.sessionId,
      name: r.name,
      cwd: r.cwd,
      kind: r.kind === 'background' || r.id ? 'background' : 'interactive',
      startedAt: r.startedAt ?? 0,
      state: oneOf(r.state, STATES),
      status: oneOf(r.status, STATUSES),
      waitingFor: r.waitingFor,
      pid: r.pid,
      detail: r.detail,
    });
  }
  return rows;
}

// ── Activity mapping (design doc §6.6) ─────────────────────

export interface SupervisorActivity {
  state: ActivityState;
  error?: ActivityError;
  detail?: string;
}

export const SESSION_REMOVED_DETAIL = 'Session removed — opening the task starts a new one';
export const SESSION_SLEEPING_DETAIL = 'Sleeping — opening the task resumes it';

/**
 * Dash activity for a task's job. `undefined` = the job is missing from the
 * `--all` listing (removed by `claude rm`, or the supervisor forgot it).
 */
export function activityFromSupervisor(row: SupervisorSession | undefined): SupervisorActivity {
  if (!row) return { state: 'stopped', detail: SESSION_REMOVED_DETAIL };
  if (row.state === 'failed') {
    return { state: 'error', error: { type: 'supervisor', message: row.detail } };
  }
  if (row.state === 'stopped' || row.pid === undefined) {
    return { state: 'stopped', detail: SESSION_SLEEPING_DETAIL };
  }
  if (row.status === 'busy') return { state: 'busy' };
  if (row.status === 'waiting') return { state: 'waiting', detail: row.waitingFor };
  return { state: 'idle' };
}

/** Rows whose cwd is `dir` itself or lives under it. */
export function isUnderDir(cwd: string, dir: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '');
  const a = norm(cwd);
  const b = norm(dir);
  return a === b || a.startsWith(b + '/') || a.startsWith(b + '\\');
}
