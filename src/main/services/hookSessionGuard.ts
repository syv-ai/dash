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
