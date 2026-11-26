import * as path from 'path';
import { encodeProjectPath } from '../utils/claudePaths';

/**
 * A Claude Code session's scratchpad: a per-session folder for its working
 * files (code.claude.com/docs/en/claude-directory, "Session scratchpad
 * directory", fetched 2026-11-26). Hooks and the statusLine name it as
 * `scratchpad_dir` (v2.1.257+); when no payload has named it yet (Dash just
 * restarted), it is derived from the documented layout:
 * `<temp>/claude-<uid>/<project>/<session-id>/scratchpad`, `<temp>` being
 * `CLAUDE_CODE_TMPDIR`, else `/private/tmp` on macOS and `os.tmpdir()` on
 * Linux. Pure: the caller passes the environment.
 */

/** The payload's `scratchpad_dir`, when it is an absolute path. */
export function scratchpadFromPayload(payload: Record<string, unknown>): string | null {
  const dir = payload.scratchpad_dir;
  return typeof dir === 'string' && path.isAbsolute(dir) ? path.resolve(dir) : null;
}

export interface ScratchpadEnv {
  platform: NodeJS.Platform;
  /** `process.getuid()`; undefined on Windows. */
  uid: number | undefined;
  /** `CLAUDE_CODE_TMPDIR`, when set in Dash's environment. */
  tmpOverride: string | undefined;
  /** `os.tmpdir()`. */
  osTmp: string;
}

/**
 * Where a session started in `cwd` keeps its scratchpad, by the documented
 * layout; null where Dash can't tell (Windows hashes `<project>`, no uid).
 * A user's `CLAUDE_CODE_TMPDIR` set only in Claude Code's settings is not in
 * Dash's environment: the payload's own dir corrects it once one arrives.
 */
export function deriveScratchpadDir(
  cwd: string,
  sessionId: string,
  env: ScratchpadEnv,
): string | null {
  if (env.platform === 'win32' || env.uid === undefined) return null;
  if (!/^[\w-]+$/.test(sessionId)) return null;
  const temp = env.tmpOverride || (env.platform === 'darwin' ? '/private/tmp' : env.osTmp);
  return path.join(temp, `claude-${env.uid}`, encodeProjectPath(cwd), sessionId, 'scratchpad');
}
