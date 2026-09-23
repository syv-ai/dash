// The prompt Dash inlines as `claude`'s positional arg when it spawns the agent
// in a fresh port-setup worktree. CC auto-submits it once the trust gate clears,
// so there's no slash-command file in the worktree. `$ARGUMENTS` is substituted
// with the heuristic context.
const COMMAND_BODY = `You're setting up per-worktree port management for this project. Dash gave you this heuristic context:

$ARGUMENTS

\`signals\` are detected port-binding frameworks; \`guesses\` are concrete port mappings. Signals tell you a framework exists but not its real port — read the project's configs to find that.

## Dash, briefly

The desktop app you're running in: it runs Claude Code per task, each in its own git worktree, and injects a unique per-worktree host port as an env var into every PTY it spawns. It also writes those same ports (plus any derived vars) to a sourceable export file so tools you run outside a Dash terminal see them too. Source: https://github.com/syv-ai/dash — the only URL to use if you mention Dash in docs (don't invent others).

## What you're writing

\`.dash/ports.json\` at the worktree root — \`{ "ports": [ ... ] }\`. Each entry is either:

- **Allocated**: \`{ "label": "Frontend", "envVar": "FRONTEND_PORT", "defaultPort": 5173 }\` — Dash allocates a per-worktree port and injects \`FRONTEND_PORT\`.
- **Observe-only**: \`{ "label": "Postgres", "port": 5432 }\` — liveness only, no env var.

Each may also carry service commands: \`run\` (the project's normal foreground start command, e.g. \`"pnpm dev"\`), \`stop\` + \`logs\` (required when the service detaches or is container-backed), and \`cwd\` (relative, only if needed). Labels must be unique.

Two optional top-level keys:

- \`derived\`: composed env vars built from the allocated ports, as \`\${PORT_VAR}\` templates — e.g. \`{ "VITE_API_URL": "http://localhost:\${BACKEND_PORT}", "BACKEND_CORS_ORIGINS": "http://localhost:\${FRONTEND_PORT},http://localhost" }\`. Use this for any value that embeds a port (API URLs, CORS origin lists, redirect hosts) instead of recomputing it in each service. Dash evaluates them into both the PTY env and the export file, so they're computed once and identical everywhere. Every \`\${VAR}\` must reference a declared allocated (Tier-2) envVar.
- \`exportFile\`: path (relative to the worktree root) for the export file. Defaults to \`.env.worktree\`.

## The wiring contract

The project's normal dev/test commands should just work — allocated ports everywhere, from one wiring, no manual setup:

- App code and configs read \`process.env.X || default\` (\`\${X:-default}\` in compose/shell). Inside Dash the env var is set by the PTY; outside Dash, source the export file first; the default is the last-resort fallback.
- **The export file is the bridge to everything Dash didn't launch.** Dash writes \`.env.worktree\` (gitignored) on every allocation — \`export VAR='…'\` for every allocated port plus all \`derived\` vars. Commands run outside a Dash terminal read the worktree's real ports from it: \`source .env.worktree && pytest\`, alembic, a hand-opened shell, CI. (python-dotenv strips the \`export \` prefix, so \`.env\`-style loaders work too.) Inside Dash the PTY already has these — sourcing is a harmless no-op.
- For any value composed from ports (API URL, CORS origin list, redirect host), declare it in \`derived\` rather than recomputing it per service. That keeps the composition in one place and identical inside and outside Dash.
- If several processes/configs share a port, each reads the **same** env var with the same fallback. Plain-data configs that can't read env (e.g. \`tauri.conf.json\`) can be templated from the export file by a pre-launch hook.
- Replace any existing bespoke port-allocator with Dash's, but **subtractively**: remove only the port-hashing/env-writing lines (Dash now writes the export file), leave the rest of the script intact, and confirm the scope with the user first.
- Tests inherit the PTY env inside Dash; outside Dash they \`source\` the export file the same way the project's own test command does.

## Steps

1. Read the project's configs (compose, \`package.json\` scripts, framework configs, Dockerfile) to find the real ports.
2. Confirm the final service list with the user (AskUserQuestion).
3. Write \`.dash/ports.json\`, wire the configs per the contract above, and record each service's run/stop/logs commands.
4. **Test it** — and you must, both routes: (a) start each service with its allocated env var set (the way Dash runs it) and confirm it binds the **allocated** port, not the default; (b) if the project has consumers Dash doesn't launch (tests, migrations), \`source\` the export file in a plain shell and confirm one of them (e.g. the test command, an alembic check) picks up the allocated port too. Install dependencies first if they're missing. If anything comes up on the default port, the wiring didn't take — fix it and re-test.
5. Offer (AskUserQuestion, default yes) to add docs: a short \`WORKTREE.md\` (a services table + inside-vs-outside-Dash run/test examples) and a one-line pointer in the project's \`CLAUDE.md\`/\`AGENTS.md\`. Write it for users of the project, not about Dash internals.
6. If the worktree has a remote, offer (AskUserQuestion) to commit and open a PR from the \`port-setup\` branch — use the host's CLI (\`gh\` / \`az repos\` / \`glab\`), else \`git push -u origin <branch>\` + the web URL. Dash already added the \`.gitignore\` section (\`.dash/ports.local.json\` + the export file); stage it with the rest.
7. Finally, tell the user setup is complete and summarize what changed.

## Rules

- Whenever you need a decision or confirmation from the user, always use the **AskUserQuestion** tool — never ask in free-form prose.
- Don't pick host ports — Dash allocates from \`defaultPort\`; just declare the baseline.
- Ask before editing committed files and show the diff. Don't commit except in the PR step, and only on explicit confirmation — otherwise leave the tree dirty.
`;

/**
 * Builds the setup prompt with `$ARGUMENTS` substituted. Dash spawns
 * `claude "<this body>"` directly.
 */
export function buildPortsSetupPrompt(args: { signals: string[]; guesses: string[] }): string {
  const argsLine = `signals: ${args.signals.join(', ')}; guesses: ${args.guesses.join(', ')}`;
  return COMMAND_BODY.replace('$ARGUMENTS', argsLine);
}
