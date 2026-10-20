import * as path from 'path';

/**
 * Every control-API file location under a userData dir. Pure (node built-ins
 * only, no electron, no path aliases) because the bundled `dash-mcp` shim
 * imports it too.
 *
 * All of it lives under `<userData>/control/`, not `<userData>/bin`, which
 * claudeEnv prepends to every agent's PATH for RTK.
 */
export interface ControlPaths {
  dir: string;
  /** HMAC secret every token derives from (0600). */
  secret: string;
  /** The control server's port while Dash runs (like `hook-port`). */
  port: string;
  /** The orchestrator token, present only while orchestrator access is on (0600). */
  orchestratorToken: string;
  /** Per-task `--mcp-config` files, `<taskId>.json`. */
  mcpConfigDir: string;
  /** The `dash-mcp` launcher script. */
  launcher: string;
  /** The launcher's copy of the bundled shim, so it outlives the app's own folder. */
  shim: string;
  /** A folder holding only `dashctl`, for a PATH (a task's, a Holi vault's). */
  cliBinDir: string;
  /** The `dashctl` command line. */
  dashctl: string;
}

export function controlPaths(userDataDir: string): ControlPaths {
  const dir = path.join(userDataDir, 'control');
  return {
    dir,
    secret: path.join(dir, 'secret'),
    port: path.join(dir, 'control-port'),
    orchestratorToken: path.join(dir, 'orchestrator-token'),
    mcpConfigDir: path.join(dir, 'mcp-config'),
    launcher: path.join(dir, 'dash-mcp'),
    shim: path.join(dir, 'dash-mcp.js'),
    cliBinDir: path.join(dir, 'bin'),
    dashctl: path.join(dir, 'bin', 'dashctl'),
  };
}
