/**
 * Claude Code's user-config layout (`CLAUDE_CONFIG_DIR`, else `~/.claude`):
 * the one module that knows where Claude keeps per-user state on disk. A
 * project's own `<repo>/.claude/` folder is a different thing and lives with
 * its consumers.
 */

/** Claude Code caps encoded dir names at this length and appends a hash. */
const MAX_ENCODED_LENGTH = 200;

/** Java's `String.hashCode` — the hash Claude Code uses for the overflow suffix. */
function javaStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Encode a cwd to the directory name Claude Code uses under `projects/`:
 * every non-alphanumeric character becomes `-` (so `/`, `\`, `:` and the `.`
 * of `.claude/worktrees` alike), and names past 200 characters are cut and
 * suffixed with a base36 hash of the raw path. Mirrors Claude Code 2.1.x
 * exactly; a mismatch makes transcript and memory lookups silently miss.
 */
export function encodeProjectPath(absolutePath: string): string {
  const encoded = absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
  if (encoded.length <= MAX_ENCODED_LENGTH) return encoded;
  const hash = Math.abs(javaStringHash(absolutePath)).toString(36);
  return `${encoded.slice(0, MAX_ENCODED_LENGTH)}-${hash}`;
}
