import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { controlPaths } from './paths';

/**
 * The `control/dash-mcp` launcher: the one command `claude mcp add` and the
 * per-task `--mcp-config` point at. Rewritten on every boot so it always runs
 * the current Dash build's shim under the current Electron, as Node.
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

/** Write `<userData>/control/dash-mcp` (0755) via tmp + rename; returns its path. */
export function writeLauncher(
  userDataDir: string,
  opts: { execPath?: string; shimPath?: string } = {},
): string {
  const file = controlPaths(userDataDir).launcher;
  const content = launcherScript({
    userDataDir,
    execPath: opts.execPath ?? process.execPath,
    shimPath: opts.shimPath ?? defaultShimPath(),
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o755 });
    // The umask may have masked bits off the create mode.
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return file;
}
