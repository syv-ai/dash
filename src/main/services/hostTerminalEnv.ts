// Dash is itself a terminal host, so it must not hand its children the
// identity of the terminal that launched *it*.
//
// When Dash starts from Finder/Dock (packaged), `process.env` is clean. When it
// starts from another terminal — `pnpm dev` in Warp, iTerm, Kitty — Electron
// inherits that terminal's session-identity vars, and every PTY, shell and
// `-lc` exec Dash spawns inherits them in turn. Each of those shells then boots
// the host terminal's shell integration and reports itself as a session that
// already belongs to a live tab.
//
// Warp is the sharp edge: `WARP_IS_LOCAL_SHELL_SESSION=1` plus a
// `WARP_TERMINAL_SESSION_UUID` that names a real tab means every shell spawned
// inside Dash impersonates that tab. An agent's first Bash tool call is enough
// to start a stream of duplicate session traffic aimed at the running Warp app.
//
// Stripping them is correct regardless of the crash: a shell inside Dash is a
// Dash session, not a Warp/iTerm/Kitty one, and should never claim otherwise.

/** Whole-namespace prefixes: everything under them is host-terminal identity. */
const HOST_TERMINAL_PREFIXES = [
  'WARP_',
  'ITERM_',
  'KITTY_',
  'GHOSTTY_',
  'WEZTERM_',
  'ALACRITTY_',
] as const;

/** Individual keys that identify the host terminal but carry no common prefix. */
const HOST_TERMINAL_KEYS = new Set([
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
]);

// Deliberately NOT stripped: VSCODE_* — those entries are load-bearing for VS
// Code's `GIT_ASKPASS` helper, and removing half the pair would hang git auth
// prompts. TERM/COLORTERM stay too: they describe capabilities, not identity.

export function isHostTerminalEnvKey(key: string): boolean {
  return (
    HOST_TERMINAL_KEYS.has(key) || HOST_TERMINAL_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Copy `env` without the launching terminal's identity vars. Callers that want
 * a specific `TERM_PROGRAM` set it themselves *after* this runs — the point is
 * that they choose it rather than inherit whatever launched Dash.
 */
export function stripHostTerminalEnv<T extends Record<string, string | undefined>>(env: T): T {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isHostTerminalEnvKey(key)) out[key] = value;
  }
  return out as T;
}
