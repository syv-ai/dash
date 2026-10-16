import * as fs from 'fs';
import * as path from 'path';
import { shellQuote } from '../../shared/shellQuote';
import { writeFileAtomic } from '../utils/atomicWrite';
import { controlPaths } from './paths';

/**
 * The `control/dash-mcp` launcher: the one command `claude mcp add` and the
 * per-task `--mcp-config` point at. Rewritten on every boot so it always runs
 * the current Dash build's shim under the current Electron, as Node. Both it
 * and a copy of the shim live in userData, and it execs the AppImage file when
 * there is one: a Linux AppImage's own executable and resources sit under a
 * per-launch mount that is gone once Dash quits, and the shim must still start
 * then to report "Dash is not running".
 */

/** The bundled shim; asar can't be exec'd, so packaged builds read it from the unpacked copy. */
export function defaultShimPath(): string {
  return path
    .join(__dirname, '..', 'scripts', 'dash-mcp.js')
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

export function launcherScript(opts: {
  userDataDir: string;
  execPath: string;
  shimPath: string;
}): string {
  return [
    '#!/bin/sh',
    '# Written by Dash on launch; points at the current Dash build.',
    `DASH_USER_DATA_DIR=${shellQuote(opts.userDataDir)} ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(opts.execPath)} ${shellQuote(opts.shimPath)} "$@"`,
    '',
  ].join('\n');
}

/** What the launcher execs: the AppImage file when Dash runs from one, else this executable. */
export function launcherExecPath(env: NodeJS.ProcessEnv, execPath = process.execPath): string {
  return env.APPIMAGE || execPath;
}

/**
 * Copy the bundled shim (self-contained) to `<userData>/control/dash-mcp.js`
 * and write `<userData>/control/dash-mcp` (0755) to run it, each via tmp +
 * rename; returns the launcher's path.
 */
export function writeLauncher(
  userDataDir: string,
  opts: { execPath?: string; bundledShimPath?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const paths = controlPaths(userDataDir);
  fs.mkdirSync(paths.dir, { recursive: true });
  writeFileAtomic(paths.shim, fs.readFileSync(opts.bundledShimPath ?? defaultShimPath()), {
    mode: 0o644,
  });
  const content = launcherScript({
    userDataDir,
    execPath: opts.execPath ?? launcherExecPath(opts.env ?? process.env),
    shimPath: paths.shim,
  });
  writeFileAtomic(paths.launcher, content, { mode: 0o755 });
  return paths.launcher;
}
