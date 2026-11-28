import { shellQuote } from '@shared/shellQuote';

/**
 * A shell prefix that ends the hook unless it runs in the session it was
 * written for. Claude Code loads the `settings.local.json` of every folder
 * above a session too, so a project that is itself a task would fire its hooks
 * (and post its own ptyId) in every worktree session under it (#191). Hooks run
 * with `CLAUDE_PROJECT_DIR` set to the session's folder; the task's path and
 * its real path both pass, and so does an unset variable, so a Claude Code
 * without it keeps reporting rather than going quiet.
 */
export function ownSessionGuard(dirs: string[]): string {
  const patterns = ["''", ...[...new Set(dirs)].map(shellQuote)];
  return `case "$CLAUDE_PROJECT_DIR" in ${patterns.join('|')}) ;; *) exit 0 ;; esac; `;
}

/**
 * The env var naming a session's task: set in the task's own settings file
 * (taskSettings, `--settings`), which Claude Code applies to the session and
 * the hooks and statusLine it runs (verified live, 2.1.332). Several tasks
 * can share one folder, and so one `settings.local.json`, whose hooks carry
 * the id of whichever task wrote it last; the variable tells them apart.
 */
export const TASK_ID_ENV = 'DASH_TASK_ID';

/**
 * The task id a hook posts as `ptyId`, expanded by `sh` when the hook runs:
 * the session's own task (TASK_ID_ENV), else `fallback`, the task that wrote
 * the file (a session dispatched before the variable existed). Goes inside a
 * double-quoted URL.
 */
export function taskIdExpansion(fallback: string): string {
  return `\${${TASK_ID_ENV}:-${fallback}}`;
}
