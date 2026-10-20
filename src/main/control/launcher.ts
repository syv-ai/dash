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
  fs.mkdirSync(paths.cliBinDir, { recursive: true });
  writeFileAtomic(paths.dashctl, dashctlScript(paths.dir), { mode: 0o755 });
  return paths.launcher;
}

/**
 * `dashctl`: POSIX sh and curl, so it starts at once and needs no Node. It
 * only carries words to `/v1/cli` (cli.ts), which owns the commands, so an
 * older copy still runs the newest Dash's. Rewritten on every boot.
 */
export function dashctlScript(controlDir: string): string {
  return `#!/bin/sh
# dashctl: ask the running Dash something. Run it bare for every command.
# Written by Dash on launch. It talks to Dash over 127.0.0.1: the port is in
# control-port; a Dash task's session carries its own token (DASH_CALLER,
# DASH_TOKEN), and anyone else uses the orchestrator token, which is there
# while "Let other agents control Dash" is on in Dash's settings.
set -eu
dir=\${DASH_CONTROL_DIR:-${shellQuote(controlDir)}}

port=$(tr -d '[:space:]' < "$dir/control-port" 2>/dev/null || true)
case "$port" in
  '' | *[!0-9]*) echo "dashctl: Dash is not running. Open Dash and try again." >&2; exit 1 ;;
esac
if [ -n "\${DASH_CALLER:-}" ] && [ -n "\${DASH_TOKEN:-}" ]; then
  caller=$DASH_CALLER
  token=$DASH_TOKEN
else
  caller=orchestrator
  token=$(tr -d '[:space:]' < "$dir/orchestrator-token" 2>/dev/null || true)
  if [ -z "$token" ]; then
    echo "dashctl: turn on \\"Let other agents control Dash\\" in Dash's settings." >&2
    exit 1
  fi
fi

out=$(mktemp)
trap 'rm -f "$out"' EXIT

# Every word rides in the body, so curl does the encoding.
for a in "$@"; do
  shift
  set -- "$@" --data-urlencode "argv=$a"
done

send() {
  curl -s -X POST -o "$out" -w '%{http_code}' \\
    -H "Authorization: Bearer $token" -H "X-Dash-Caller: $caller" \\
    "http://127.0.0.1:$port/v1/cli" "$@"
}

if ! code=$(send "$@"); then
  echo "dashctl: Dash is not running. Open Dash and try again." >&2
  exit 1
fi
if [ "$code" = 428 ]; then
  # The command reads an input from stdin and it wasn't given as a flag; Dash
  # ran nothing. Send stdin, once (nothing, from a terminal).
  if [ -t 0 ]; then code=$(send "$@" --data-urlencode "stdin=") || exit 1
  else code=$(send "$@" --data-urlencode "stdin@-") || exit 1
  fi
fi

# 200: the answer, to stdout. 400: usage, to stderr, exit 2. Anything else is
# a refusal, to stderr, exit 1.
case "$code" in
  200) cat "$out"; echo ;;
  400) cat "$out" >&2; echo >&2; exit 2 ;;
  *) cat "$out" >&2; echo >&2; exit 1 ;;
esac
`;
}
