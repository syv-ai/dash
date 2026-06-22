// The prompt Dash inlines as `claude`'s positional arg when it spawns the agent
// in a fresh port-setup worktree. CC auto-submits it once the trust gate clears,
// so there's no slash-command file in the worktree. `$ARGUMENTS` is substituted
// with the heuristic context.
const COMMAND_BODY = `You're setting up per-worktree port management for this project. Dash gave you this heuristic context:

$ARGUMENTS

\`signals\` are detected port-binding frameworks; \`guesses\` are concrete port mappings. Signals tell you a framework exists but not its real port — read the project's configs to find that.

## Dash, briefly

The desktop app you're running in: it runs Claude Code per task, each in its own git worktree, and injects a unique per-worktree host port as an env var into every PTY it spawns. Source: https://github.com/syv-ai/dash — the only URL to use if you mention Dash in docs (don't invent others).

## What you're writing

\`.dash/ports.json\` at the worktree root — \`{ "ports": [ ... ] }\`. Each entry is either:

- **Allocated**: \`{ "label": "Frontend", "envVar": "FRONTEND_PORT", "defaultPort": 5173 }\` — Dash allocates a per-worktree port and injects \`FRONTEND_PORT\`.
- **Observe-only**: \`{ "label": "Postgres", "port": 5432 }\` — liveness only, no env var.

Each may also carry service commands: \`run\` (the project's normal foreground start command, e.g. \`"pnpm dev"\`), \`stop\` + \`logs\` (required when the service detaches or is container-backed), and \`cwd\` (relative, only if needed). Labels must be unique.

## The wiring contract

The project's normal dev/test commands should just work — allocated ports inside Dash, hardcoded defaults outside — from one wiring, no manual setup:

- App code and configs read \`process.env.X || default\` (\`\${X:-default}\` in compose/shell). Inside Dash the env var is set; outside, the default applies. Standard practice, not Dash-specific.
- If several processes/configs share a port (Tauri, Electron, frontend + API, …), each reads the **same** env var with the same fallback. For plain-data configs that can't read env (e.g. \`tauri.conf.json\`), template them from a pre-launch hook into a gitignored file.
- Replace any existing bespoke port-allocator with Dash's, but **subtractively**: remove only the port-hashing lines, leave the rest of the script intact, and confirm the scope with the user first.
- Tests inherit the PTY env — test code reads \`process.env.X || default\` the same way.
- **Never** source a Dash env file (there isn't one), direnv, or \`.envrc\`. Outside Dash = defaults, by design.

## Steps

1. Read the project's configs (compose, \`package.json\` scripts, framework configs, Dockerfile) to find the real ports.
2. Confirm the final service list with the user (AskUserQuestion).
3. Write \`.dash/ports.json\`, wire the configs per the contract above, and record each service's run/stop/logs commands.
4. **Test it** — and you must: start each service with its allocated env var set (the same way Dash runs it) and confirm it binds the **allocated** port, not the default. Install dependencies first if they're missing. If a service comes up on the default port, the wiring didn't take — fix it and re-test.
5. Offer (AskUserQuestion, default yes) to add docs: a short \`WORKTREE.md\` (a services table + inside-vs-outside-Dash run/test examples) and a one-line pointer in the project's \`CLAUDE.md\`/\`AGENTS.md\`. Write it for users of the project, not about Dash internals.
6. If the worktree has a remote, offer (AskUserQuestion) to commit and open a PR from the \`port-setup\` branch — use the host's CLI (\`gh\` / \`az repos\` / \`glab\`), else \`git push -u origin <branch>\` + the web URL. Dash already added the \`.gitignore\` section (\`.dash/ports.local.json\`); stage it with the rest.
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
