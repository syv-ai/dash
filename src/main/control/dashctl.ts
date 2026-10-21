import * as fs from 'fs';
import { shellQuote } from '../../shared/shellQuote';
import { writeFileAtomic } from '../utils/atomicWrite';
import { controlPaths } from './paths';

/**
 * Write `<userData>/control/bin/dashctl` (0755, via tmp + rename) and return
 * its path. Run on every boot.
 */
export function writeDashctl(userDataDir: string): string {
  const paths = controlPaths(userDataDir);
  fs.mkdirSync(paths.cliBinDir, { recursive: true });
  writeFileAtomic(paths.dashctl, dashctlScript(paths.dir), { mode: 0o755 });
  return paths.dashctl;
}

/**
 * `dashctl`: POSIX sh and curl, so it starts at once and needs no Node. It
 * only carries words to `/v1/cli` (cli.ts), which owns the commands, so an
 * older copy still runs the newest Dash's. Rewritten on every boot.
 */
export function dashctlScript(controlDir: string): string {
  return `#!/bin/sh
# dashctl: ask the running Dash something. \`dashctl help\` lists every command.
# Written by Dash on launch. It talks to Dash over 127.0.0.1: the port is in
# control-port; a Dash task's session carries its own token (DASH_CALLER,
# DASH_TOKEN), and anyone else uses the orchestrator token, which is there
# while "Let other agents control Dash" is on in Dash's settings (when it is
# off, Dash asks its user to turn it on).
set -eu
dir=\${DASH_CONTROL_DIR:-${shellQuote(controlDir)}}

port=$(tr -d '[:space:]' 2>/dev/null < "$dir/control-port" || true)
case "$port" in
  '' | *[!0-9]*) echo "dashctl: Dash is not running. Open Dash and try again." >&2; exit 1 ;;
esac
if [ -n "\${DASH_CALLER+set}\${DASH_TOKEN+set}" ]; then
  # A task's session. Never fall back to the orchestrator's wider token.
  if [ -z "\${DASH_CALLER:-}" ] || [ -z "\${DASH_TOKEN:-}" ]; then
    echo "dashctl: DASH_CALLER and DASH_TOKEN go together, and one is empty." >&2
    exit 1
  fi
  caller=$DASH_CALLER
  token=$DASH_TOKEN
else
  caller=orchestrator
  token=$(tr -d '[:space:]' 2>/dev/null < "$dir/orchestrator-token" || true)
  if [ -z "$token" ]; then
    # Access is off: Dash asks its user (Allow / Deny) and answers once they
    # do. Allow turns the setting on, which writes the token.
    echo "dashctl: asking in Dash for access; waiting for an answer there." >&2
    asked=$(curl -s -X POST -o /dev/null -w '%{http_code}' --max-time 120 \\
      "http://127.0.0.1:$port/v1/access" || true)
    [ "$asked" = 200 ] && token=$(tr -d '[:space:]' 2>/dev/null < "$dir/orchestrator-token" || true)
    if [ -z "$token" ]; then
      echo "dashctl: not allowed. To allow it, turn on \\"Let other agents control Dash\\" in Dash's settings." >&2
      exit 1
    fi
  fi
fi

out=$(mktemp)
trap 'rm -f "$out"' EXIT

# Every word rides in the body, so curl does the encoding.
for a in "$@"; do
  shift
  set -- "$@" --data-urlencode "argv=$a"
done

# The token reaches curl on fd 3, from a heredoc: not in its argv, which any
# process can read, and not in a file a killed run would leave behind.
send() {
  curl -s -X POST -o "$out" -w '%{http_code}' -H @/dev/fd/3 \\
    --data-urlencode "cwd=$PWD" "http://127.0.0.1:$port/v1/cli" "$@" 3<<HEADERS
Authorization: Bearer $token
X-Dash-Caller: $caller
HEADERS
}

if ! code=$(send "$@"); then
  echo "dashctl: Dash is not running. Open Dash and try again." >&2
  exit 1
fi
if [ "$code" = 428 ]; then
  # The command reads an input from stdin (it's required and wasn't given, or
  # was given as -); Dash ran nothing. Send stdin, once (nothing, from a
  # terminal).
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
