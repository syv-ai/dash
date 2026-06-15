import path from 'path';

/**
 * macOS caps AF_UNIX socket paths at 104 bytes (`sun_path`, including the NUL);
 * Linux allows 108. Stay under the smaller limit.
 */
export const MAX_UNIX_SOCKET_PATH = 104;

/**
 * Build a side-car TUI socket path. Deliberately short — just a feature tag and
 * a random token — so the full path fits within MAX_UNIX_SOCKET_PATH.
 *
 * A previous scheme embedded the 36-char task UUID, pushing the path to ~124
 * bytes under the default macOS userData dir. The kernel truncated it mid-UUID
 * (before the random token), so every spawn for a given task bound the SAME
 * truncated address → EADDRINUSE, and `unlink(fullPath)` couldn't clean it
 * (the real file lived at the truncated name). Dropping the UUID keeps the path
 * short and the token effective. The `tui-` prefix is load-bearing: sweepSockets
 * matches it to clear orphans at boot.
 *
 * The feature tag is only for human debugging, so it's capped — the random token
 * is what guarantees uniqueness — keeping the name bounded regardless of how
 * long a feature id grows.
 */
export function tuiSocketPath(socketDir: string, featureId: string, token: string): string {
  return path.join(socketDir, `tui-${featureId.slice(0, 8)}-${token}.sock`);
}
