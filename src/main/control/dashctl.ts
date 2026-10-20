import * as fs from 'fs';
import * as path from 'path';
import { shellQuote } from '../../shared/shellQuote';
import { writeFileAtomic } from '../utils/atomicWrite';
import { controlPaths } from './paths';

/**
 * Write `<userData>/control/bin/dashctl` (0755, via tmp + rename) and return
 * its path. Run on every boot. Also retires what the MCP door left there: its
 * launcher and the shim's copy go, and each per-task `--mcp-config` becomes an
 * empty one rather than going, since a job the supervisor started with one
 * passes that path again on every respawn.
 */
export function writeDashctl(userDataDir: string): string {
  const paths = controlPaths(userDataDir);
  fs.mkdirSync(paths.cliBinDir, { recursive: true });
  writeFileAtomic(paths.dashctl, dashctlScript(paths.dir), { mode: 0o755 });
  for (const legacy of ['dash-mcp', 'dash-mcp.js']) {
    fs.rmSync(path.join(paths.dir, legacy), { force: true });
  }
  const mcpConfigDir = path.join(paths.dir, 'mcp-config');
  for (const file of fs.existsSync(mcpConfigDir) ? fs.readdirSync(mcpConfigDir) : []) {
    writeFileAtomic(path.join(mcpConfigDir, file), '{ "mcpServers": {} }\n', { mode: 0o600 });
  }
  return paths.dashctl;
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
