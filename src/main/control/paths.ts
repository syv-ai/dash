import * as path from 'path';

/**
 * Every control-API file location under a userData dir. Pure (node built-ins
 * only, no electron), so tests build it for a temp dir.
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
    cliBinDir: path.join(dir, 'bin'),
    dashctl: path.join(dir, 'bin', 'dashctl'),
  };
}
