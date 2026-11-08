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
 *
 * A stream command (`tasks watch`) answers with JSON lines that never end, so
 * the script reads the headers itself and prints a stream as it comes. A copy
 * from before streams buffers every answer; it sends no `Accept:
 * application/x-ndjson`, so Dash refuses it a stream command (cli.ts) instead
 * of leaving it waiting, and runs every other command as before.
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

work=$(mktemp -d)
out=$work/out
trap 'rm -rf "$work"' EXIT
# Killed (a background run being stopped): take curl and the reader along, so
# Dash sees the stream's client go.
pids=
trap '[ -z "$pids" ] || kill $pids 2>/dev/null; exit 129' HUP
trap '[ -z "$pids" ] || kill $pids 2>/dev/null; exit 130' INT
trap '[ -z "$pids" ] || kill $pids 2>/dev/null; exit 143' TERM
cr=$(printf '\\r')
# A background job's stdin is /dev/null unless given: keep this one for curl
# (or /dev/null, if it's closed).
{ command exec 4<&0; } 2>/dev/null || exec 4</dev/null

# Every word rides in the body, so curl does the encoding.
for a in "$@"; do
  shift
  set -- "$@" --data-urlencode "argv=$a"
done

# The token reaches curl on fd 3, from a heredoc: not in its argv, which any
# process can read, and not in a file a killed run would leave behind. The
# answer comes with its headers (-i), unbuffered (-N), so a stream's lines
# can be printed as they come; Accept tells Dash this copy can.
send() {
  exec curl -siN -X POST -H @/dev/fd/3 \\
    --data-urlencode "cwd=$PWD" "http://127.0.0.1:$port/v1/cli" "$@" 3<<HEADERS
Authorization: Bearer $token
X-Dash-Caller: $caller
Accept: application/x-ndjson, text/plain
HEADERS
}

# Read an answer, headers first. 200: the answer, to stdout; a stream
# (application/x-ndjson), line by line as it comes, until it ends. 400: usage,
# to stderr, exit 2. 428: exit 3, to send stdin. Anything else is a refusal,
# to stderr, exit 1. No answer at all: Dash isn't there.
answer() {
  code=
  stream=
  while IFS= read -r line; do
    line=\${line%"$cr"}
    case "$line" in
      HTTP/*) code=\${line#* }; code=\${code%% *}; stream= ;;
      [Cc][Oo][Nn][Tt][Ee][Nn][Tt]-[Tt][Yy][Pp][Ee]:*application/x-ndjson*) stream=1 ;;
      '') case "$code" in 1??) ;; *) break ;; esac ;;
    esac
  done
  case "$code" in
    '') echo "dashctl: Dash is not running. Open Dash and try again." >&2; return 1 ;;
    200) if [ -n "$stream" ]; then cat; else cat > "$out"; cat "$out"; echo; fi ;;
    428) return 3 ;;
    400) cat > "$out"; cat "$out" >&2; echo >&2; return 2 ;;
    *) cat > "$out"; cat "$out" >&2; echo >&2; return 1 ;;
  esac
}

# curl and the reader run in the background, joined by a fifo, and the script
# waits for them: a signal ends a wait at once (not a foreground command).
ask() {
  rm -f "$work/answer"
  mkfifo "$work/answer"
  send "$@" > "$work/answer" 0<&4 &
  curl_pid=$!
  answer < "$work/answer" &
  pids="$curl_pid $!"
  status=0
  wait $! || status=$?
  wait "$curl_pid" || true
  pids=
  return "$status"
}

rc=0
ask "$@" || rc=$?
if [ "$rc" = 3 ]; then
  # The command reads an input from stdin (it's required and wasn't given, or
  # was given as -); Dash ran nothing. Send stdin, once (nothing, from a
  # terminal).
  rc=0
  if [ -t 0 ]; then ask "$@" --data-urlencode "stdin=" || rc=$?
  else ask "$@" --data-urlencode "stdin@-" || rc=$?
  fi
  [ "$rc" = 3 ] && rc=1
fi
exit "$rc"
`;
}
