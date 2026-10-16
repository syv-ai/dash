import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
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

/** Single-quote for sh: `'` → `'\''`. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function launcherScript(opts: {
  userDataDir: string;
  execPath: string;
  shimPath: string;
}): string {
  return [
    '#!/bin/sh',
    '# Written by Dash on launch; points at the current Dash build.',
    `DASH_USER_DATA_DIR=${shQuote(opts.userDataDir)} ELECTRON_RUN_AS_NODE=1 exec ${shQuote(opts.execPath)} ${shQuote(opts.shimPath)} "$@"`,
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
  writeAtomic(paths.shim, fs.readFileSync(opts.bundledShimPath ?? defaultShimPath()), 0o644);
  const content = launcherScript({
    userDataDir,
    execPath: opts.execPath ?? launcherExecPath(opts.env ?? process.env),
    shimPath: paths.shim,
  });
  writeAtomic(paths.launcher, content, 0o755);
  return paths.launcher;
}

function writeAtomic(file: string, content: string | Buffer, mode: number): void {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode });
    // The umask may have masked bits off the create mode.
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
