import { shellQuote } from '../../shared/shellQuote';
import { callerString, type Caller } from './callers';
import { commandName } from './cli';
import { initializedPaths, tokenFor } from './tokens';

/*
 * What a task with Dash access needs in its session to call Dash with
 * `dashctl`. It all goes in the task's `--settings` file, the one channel
 * that reaches a session the supervisor pre-spawned, rewritten on every
 * session start:
 *
 * - `env`: who the caller is and its token. The token is derived, not stored,
 *   so it stays valid across Dash restarts.
 * - a SessionStart hook that appends dashctl's folder to `PATH` through
 *   `CLAUDE_ENV_FILE`, which Claude Code runs before each Bash command. The
 *   settings `env` block can't: its values are literal, so it could only
 *   replace `PATH`.
 * - allow rules for the read-only commands, so reading never prompts.
 */

/** Set by control/index.ts once capabilities register (importing the registry here would cycle). */
let readOnlyCapabilities: string[] = [];

/** The capabilities a task's session may call without a permission prompt. */
export function setReadOnlyCapabilities(names: string[]): void {
  readOnlyCapabilities = [...names];
}

export interface CommandHook {
  type: 'command';
  command: string;
}

export interface DashSessionAccess {
  env: Record<string, string>;
  /** `permissions.allow` rules. */
  allow: string[];
  /** SessionStart hooks, for every source (startup, resume, clear, compact). */
  sessionStart: CommandHook[];
  /** dashctl's own path, for a session whose PATH lacks it. */
  dashctl: string;
}

/** The task's access, or null without Dash access or before the control API runs. */
export function dashSessionAccess(task: {
  id: string;
  dashAccess: boolean;
}): DashSessionAccess | null {
  const paths = initializedPaths();
  if (!task.dashAccess || !paths) return null;
  const caller: Caller = { kind: 'task', taskId: task.id };
  const exportPath = `export PATH="$PATH":${shellQuote(paths.cliBinDir)}`;
  return {
    env: { DASH_CALLER: callerString(caller), DASH_TOKEN: tokenFor(caller) },
    allow: readOnlyCapabilities.map((name) => `Bash(dashctl ${commandName(name)}:*)`),
    sessionStart: [
      {
        type: 'command',
        command: `[ -n "$CLAUDE_ENV_FILE" ] && printf '%s\\n' ${shellQuote(exportPath)} >> "$CLAUDE_ENV_FILE"; exit 0`,
      },
    ],
    dashctl: paths.dashctl,
  };
}
