import * as fs from 'fs';
import * as path from 'path';
import { shellQuote } from '../../shared/shellQuote';
import { writeFileAtomic } from '../utils/atomicWrite';
import { controlPaths } from './paths';
import { initializedPaths } from './tokens';

const EMPTY_MCP_CONFIG = '{ "mcpServers": {} }\n';
const legacyMcpConfigDir = (controlDir: string) => path.join(controlDir, 'mcp-config');

/**
 * Write `<userData>/control/bin/dashctl` (0755, via tmp + rename) and return
 * its path. Run on every boot. Also retires what the MCP door left there: the
 * shim's copy goes; the launcher, which a `claude mcp add dash` registration
 * may still run, becomes a stub that says to use dashctl; and each per-task
 * `--mcp-config` becomes an empty one rather than going, since a job the
 * supervisor started with one passes that path again on every respawn (it
 * goes when its task is deleted).
 */
export function writeDashctl(userDataDir: string): string {
  const paths = controlPaths(userDataDir);
  fs.mkdirSync(paths.cliBinDir, { recursive: true });
  writeFileAtomic(paths.dashctl, dashctlScript(paths.dir), { mode: 0o755 });
  fs.rmSync(path.join(paths.dir, 'dash-mcp.js'), { force: true });
  const launcher = path.join(paths.dir, 'dash-mcp');
  if (fs.existsSync(launcher)) {
    writeFileAtomic(launcher, retiredMcpLauncher(paths.dashctl), { mode: 0o755 });
  }
  const mcpConfigDir = legacyMcpConfigDir(paths.dir);
  for (const file of fs.existsSync(mcpConfigDir) ? fs.readdirSync(mcpConfigDir) : []) {
    const config = path.join(mcpConfigDir, file);
    if (fs.readFileSync(config, 'utf8') === EMPTY_MCP_CONFIG) continue;
    writeFileAtomic(config, EMPTY_MCP_CONFIG, { mode: 0o600 });
  }
  return paths.dashctl;
}

/** Remove a deleted task's emptied `--mcp-config`; a no-op when it has none. */
export function removeLegacyMcpConfig(taskId: string): void {
  const paths = initializedPaths();
  if (!paths) return;
  fs.rmSync(path.join(legacyMcpConfigDir(paths.dir), `${taskId}.json`), { force: true });
}

/** What the MCP launcher becomes: a server that fails at once, saying why. */
export function retiredMcpLauncher(dashctl: string): string {
  return `#!/bin/sh
# Left by Dash where its MCP server's launcher was, so an old
# \`claude mcp add dash\` registration says why it stopped working.
dashctl=${shellQuote(dashctl)}
echo "Dash's MCP server is gone; use dashctl instead, at $dashctl (and run: claude mcp remove dash)." >&2
exit 1
`;
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
# while "Let other agents control Dash" is on in Dash's settings.
set -eu
dir=\${DASH_CONTROL_DIR:-${shellQuote(controlDir)}}

port=$(tr -d '[:space:]' < "$dir/control-port" 2>/dev/null || true)
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
  token=$(tr -d '[:space:]' < "$dir/orchestrator-token" 2>/dev/null || true)
  if [ -z "$token" ]; then
    echo "dashctl: turn on \\"Let other agents control Dash\\" in Dash's settings." >&2
    exit 1
  fi
fi

out=$(mktemp)
headers=$(mktemp)
trap 'rm -f "$out" "$headers"' EXIT
# The token reaches curl in a file (mktemp's are 0600), not in its argv, which
# any process can read.
printf 'Authorization: Bearer %s\\nX-Dash-Caller: %s\\n' "$token" "$caller" > "$headers"

# Every word rides in the body, so curl does the encoding.
for a in "$@"; do
  shift
  set -- "$@" --data-urlencode "argv=$a"
done

send() {
  curl -s -X POST -o "$out" -w '%{http_code}' -H "@$headers" \\
    --data-urlencode "cwd=$PWD" "http://127.0.0.1:$port/v1/cli" "$@"
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
