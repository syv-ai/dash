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
  /** The task's settings file (buildSessionSettings) → `--settings`. */
  settingsPath?: string;
  /** Claude session UUID to continue (migrated or re-dispatched task). */
  resumeSessionId?: string | null;
  /** Per-task `--mcp-config` file (tasks with Dash access). */
  mcpConfigPath?: string;
  /** Optional first prompt, always the last positional, after `--`. */
  prompt?: string;
}

/** What a task's `--settings` file holds. */
export interface SessionSettings {
  ultracode?: true;
  permissions?: { allow: string[] };
  env?: Record<string, string>;
}

/**
 * The task's session settings. They go in a file, not inline: the session
 * runs in a process the supervisor pre-spawned, so the dispatch's own env
 * never reaches it; `--settings` → `env` does, and the job re-reads the file
 * on every respawn. A file also keeps user env values out of `ps`.
 */
export function buildSessionSettings(opts: {
  ultracode?: boolean;
  /** `permissions.allow` rules (the read-only Dash tools). */
  allowTools?: string[];
  env?: Record<string, string>;
}): SessionSettings {
  const settings: SessionSettings = {};
  if (opts.ultracode) settings.ultracode = true;
  if (opts.allowTools?.length) settings.permissions = { allow: opts.allowTools };
  if (opts.env && Object.keys(opts.env).length > 0) settings.env = opts.env;
  return settings;
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
  // Always explicit: without a flag the user's own `defaultMode` applies,
  // which can be bypassPermissions behind a task Dash shows as Default.
  if (opts.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', opts.permissionMode ?? 'default');
  }
  if (opts.model && opts.model !== 'default') {
    args.push('--model', opts.model);
  }
  // Single-valued, so its position is free; a second one would replace it.
  if (opts.settingsPath) {
    args.push('--settings', opts.settingsPath);
  }
  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  }
  if (opts.prompt) {
    args.push('--', opts.prompt);
  }
  return args;
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
