import * as fs from 'fs';
import * as path from 'path';

const COMMANDS_DIR = path.join('.claude', 'commands');
const COMMAND_FILE = 'dash-port-setup.md';
const GITIGNORE_FILE = '.gitignore';

const GITIGNORE_HEADER = '# Dash — slash command (generated per-worktree; do not commit)';
const GITIGNORE_ENTRIES = ['.claude/commands/dash-port-setup.md'];

const COMMAND_BODY = `---
description: Set up per-worktree port management for this project (Dash)
---

You are setting up per-worktree port management for this project. Dash invoked you with the following heuristic context:

$ARGUMENTS

Format: \`signals: <comma list of detected frameworks/tools>; guesses: <Label (ENV_VAR=defaultPort), ...>\`. Guesses come from concrete sources like compose port mappings. Signals are framework matches — they tell you a port-binding framework exists, but the actual port isn't known until you read the project's config files.

## What Dash is

The Electron desktop app you're running inside. Orchestrates Claude Code sessions across multiple projects, each task in its own git worktree. Built by Syv. Source: https://github.com/syv-ai/dash.

When writing about Dash anywhere in this project's docs: that URL is the only URL allowed — do not invent \`dash.dev\`, \`dash.so\`, marketing sites, version numbers, or taglines. Stick to the facts above.

## What you're writing

A \`.dash/ports.json\` file at the worktree root — a JSON object with a top-level \`ports\` array. Each entry has one of two shapes:

- **Allocated**: \`{ "label": "Frontend", "envVar": "FRONTEND_PORT", "defaultPort": 5173 }\` — Dash hashes a unique host port per worktree from \`defaultPort\` and injects \`FRONTEND_PORT\` into every PTY Dash spawns.
- **Fixed observe-only**: \`{ "label": "Postgres", "port": 5432 }\` — Dash just shows liveness, no allocation, no env var.

## Steps

1. **Reset the completion sentinel first.** If \`.dash/setup-complete\` exists from a previous run, delete it. Do this BEFORE anything else — Dash watches that file to know when you're done, and a stale one would make it prompt the user mid-flow.
2. Read the project files (compose files, \`package.json\` scripts, vite/next/framework configs, Dockerfile) to confirm the real ports — don't trust the heuristic alone.
3. Use the AskUserQuestion tool to confirm the final service list with the user.
4. Write \`.dash/ports.json\`.
5. Verify the project's run mechanism honors the env vars (see **Wiring** below).
6. Ask about the documentation additions (see **Documentation** below).
7. **As your final action**, write an empty file at \`.dash/setup-complete\`. This is Dash's signal that everything is done — without it, the user keeps seeing a "still working" indicator and never gets prompted to restart. Write this AFTER all other work, including documentation and final user messages.
8. Then tell the user: setup is complete; Dash is now showing a toast bottom-right with the allocated port count and a **Restart session** button — click it to restart this Claude agent and the shell drawers with the new env vars (otherwise the running PTYs still have the old env). If the toast was dismissed, they can restart the task manually. Name the toast and button explicitly — don't be vague.

## Wiring: the contract

**Goal: the project's normal dev commands (\`npm run dev\`, etc.) "just work" — with allocated per-worktree ports inside Dash, with the hardcoded defaults outside Dash. No manual sourcing, no per-machine setup, no extra steps per run. Both behaviors come for free from the same wiring.**

What to do:

- **Application code** (\`server.js\`, \`vite.config.ts\`, framework configs) reads env vars with sensible defaults: \`process.env.SERVER_PORT || 8080\`, \`parseInt(process.env.OFFICE_VIEWER_PORT || '5173', 10)\`, etc. Inside Dash, the PTY has these set (Dash injects per-worktree allocations). Outside Dash, the defaults apply. Standard Node/Python practice — not Dash-specific.
- **Compose files** use \`\${VAR:-default}\` interpolation in port mappings (e.g. \`\${FRONTEND_PORT:-5173}:5173\`). Compose reads env from the spawning shell — Dash's PTY provides it inside Dash; the default applies elsewhere.
- **Replace any pre-existing bespoke port-allocator** with Dash's allocation — two allocators picking ports means collisions, and a script that \`export\`s its own values silently overrides Dash. **But**: do this **subtractively**. The script (\`dev.sh\`, \`start.sh\`, etc.) often also handles CORS derivation, dep checks, env-file loading, watch/PID management — load-bearing things that have nothing to do with port hashing. **Isolate** the port-hashing block (the \`cksum\`/\`hash\`/OFFSET arithmetic and the \`export VAR=…\` lines that follow), remove **only** that block, and leave the rest of the script intact. Before doing this, list the affected lines and confirm the scope with the user via AskUserQuestion — they may have stricter constraints than "preserve everything else".

What NOT to do:

- **NO** \`source .dash/ports.env\` in \`package.json\` scripts, shell scripts, Dockerfiles, or any committed file. Redundant inside Dash (the PTY already has the env vars).
- **NO** instructions to source files, **NO** direnv / \`.envrc\` recommendation, **NO** opt-in tooling to bridge outside-Dash usage. Outside Dash = defaults, **by design**. Single-worktree workflows, CI, fresh clones, and non-Dash contributors all work fine that way — don't try to "fix" it.

The project ends up Dash-aware only in the trivial \`process.env.X || default\` sense, indistinguishable from generic good practice.

## Multi-binding setups: when more than one process / config must agree on the port

Most frameworks bind ONE port in ONE process and the pattern above is enough. Some don't — Tauri couples Vite + Rust shell; Electron couples renderer + main; Storybook couples manager + preview; many apps couple a frontend dev server + a separate API; a worker tier consumes a queue's port. **Every part of the system that references the port has to read from the same env var with the same fallback** — otherwise the parts land on different ports and stop talking to each other.

Three resolution patterns by config style — pick by framework, not by preference:

- **Configs that natively support env interpolation** (\`compose.yaml\`, \`vite.config.ts/js\`, \`next.config.js\`, \`webpack.config.js\`, \`*.config.mjs\`, \`pyproject.toml\` read by your runtime, Rust build.rs reading env, etc.): substitute in place — \`process.env.X || default\` for JS/TS, \`\${X:-default}\` for compose / shell, \`std::env::var("X").unwrap_or("default".into())\` for Rust, etc. This is the easy case.
- **Configs that are plain data with no interpolation** (Tauri's \`tauri.conf.json\`, some Helm values files, certain TOML configs, hardcoded JSON manifests): plain JSON can't read env vars. Two ways out: (a) use the framework's pre-launch hook (\`before_dev_command\`, \`prestart\` npm script, Makefile target) to run a tiny script that templates the value into a gitignored sibling config — generate \`tauri.conf.json\` from \`tauri.conf.template.json\` at \`before_dev_command\` time, then Tauri reads the generated file. Or (b) if the framework accepts a CLI flag (\`--port\`, \`--devUrl\`), pass it from a wrapper script that reads env. Choose the framework's idiomatic hook.
- **Multiple coupled scripts** (a Makefile + a Node entry point + a shell helper all need to know the port): each one reads the same env var with the same fallback. Don't try to share via a config file that some of them can't read.

## Test suites

Same env-fallback pattern as the app — no extra rules. Inside Dash, the PTY has the env vars set; processes spawned from it (\`pnpm test\`, \`vitest\`, \`jest\`, \`pytest\`, \`cargo test\`, \`playwright\`, \`cypress\`) inherit them, and so do wrappers like \`start-server-and-test\`, \`concurrently\`, \`pnpm dev & pnpm test\`, or Makefile targets. Outside Dash → defaults.

When test code needs the port (E2E targeting a dev server, integration tests against a real backend): read \`process.env.SERVER_PORT || 8080\` from inside the test, exactly like the app. Do NOT introduce a test-specific env-loading mechanism; do NOT tell users to source \`.dash/ports.env\` before tests.

## Documentation

After wiring is done, use the AskUserQuestion tool to ask the user whether to add (default: yes to both):

1. **\`WORKTREE.md\` at the project root** — an **operational guide** for humans working in THIS project under Dash's port management. Cover these sections in order, in this style:

   **a. Services** — a table: \`Service | Env var | Default port | Where it runs\`. One row per service from \`.dash/ports.json\`.

   **b. Running services — inside vs outside Dash.** Show the project's *actual* dev command (whatever it is — \`pnpm dev\`, \`pnpm tauri dev\`, \`make serve\`, \`docker compose up\`, \`cargo run\`, etc.) with both behaviors side by side. Use the project's real env var names and a plausible allocated port (e.g. one digit off the default). Concise — a code block each side, plus a one-line caption. Pattern to follow (adapt to this project's actual commands):

       \`\`\`sh
       # Inside Dash
       <project's dev command>
       # → binds OFFICE_VIEWER_PORT (e.g. 6173 for this worktree)
       \`\`\`

       \`\`\`sh
       # Outside Dash (vanilla shell, CI, fresh clone, IDE run button)
       <project's dev command>
       # → binds the default 5173
       \`\`\`

       *Same command, different port — the env-var fallback handles both.*

   **c. Running tests — inside vs outside Dash.** Same pattern. Cover the project's actual test command(s) — if it has E2E, integration, or anything that targets a service URL, show that one specifically. Concrete example pattern:

       \`\`\`sh
       # Inside Dash
       <project's test command>
       # → tests target the allocated SERVER_PORT (e.g. http://localhost:9080)
       \`\`\`

       \`\`\`sh
       # Outside Dash
       <project's test command>
       # → tests target the default http://localhost:8080
       \`\`\`

       *Tests read the same env var as the app, so they follow whichever port is active. No env file to source.*

   **d. What changed.** One short paragraph. The app config (and any test code that hits a service port) now reads from env vars with the original default as the fallback. Everything else — \`package.json\` scripts, Dockerfile, run commands — is unchanged.

   **Hard rules**:
   - Do NOT mention manual sourcing of \`.dash/ports.env\`, direnv, \`.envrc\`, or any opt-in setup for outside-Dash usage. Outside Dash = defaults, period.
   - Do NOT mention Windows, PowerShell, cmd, cross-platform concerns, CI specifics, or Docker unless the codebase actually uses those environments (grep / check before writing). Generic platform warnings for hypothetical contributors are noise.
   - Do NOT repeat the design rationale from this prompt; the file is for users of this project, not maintainers of Dash. Aim for "I show up, run the dev command, it works" — that's the entire contract for the reader.
   - Keep the file tight — roughly 40-60 lines is fine for the four sections above. Don't pad.

2. **A pointer in \`CLAUDE.md\` or \`AGENTS.md\`** — whichever the project already uses (check first; only add to one). A single short line so future agents working on this repo don't try to reinvent port hashing. Example: "Per-worktree dev ports are managed by Dash via \`.dash/ports.json\`. See WORKTREE.md."

## Rules

- DO NOT pick host port numbers yourself — Dash handles allocation deterministically from \`defaultPort\`. Just declare the baseline.
- ASK the user before modifying any committed files. Show the diff first.
- DO NOT commit anything. Leave the working tree dirty for the user to review.
`;

/**
 * Installs the `/dash-port-setup` slash command into a worktree so the Claude
 * Code agent can be invoked with the structured prompt. Writes to
 * `<worktreePath>/.claude/commands/dash-port-setup.md`, idempotent overwrite so
 * each Dash launch ships the current body. Also gitignores the file under a
 * distinct header so a re-install in the same worktree doesn't restack
 * duplicate lines.
 *
 * Throws on filesystem errors so the caller (IPC handler) can surface them to
 * the renderer — we don't want to silently inject `/dash-port-setup ...` into
 * the TUI when the command file isn't actually there for the agent to read.
 */
export function installPortsSetupCommand(worktreePath: string): void {
  const commandsDir = path.join(worktreePath, COMMANDS_DIR);
  const commandPath = path.join(commandsDir, COMMAND_FILE);

  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }
  fs.writeFileSync(commandPath, COMMAND_BODY, 'utf-8');

  ensureGitignoreEntries(worktreePath);
}

function ensureGitignoreEntries(worktreePath: string): void {
  const gitignorePath = path.join(worktreePath, GITIGNORE_FILE);
  let existing = '';
  try {
    if (fs.existsSync(gitignorePath)) {
      existing = fs.readFileSync(gitignorePath, 'utf-8');
    }
  } catch (err) {
    console.error(
      `[PortsSetupCommandInstaller] Failed to read ${gitignorePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (existing.includes(GITIGNORE_HEADER)) return;

  const separator =
    existing.length === 0
      ? ''
      : existing.endsWith('\n\n')
        ? ''
        : existing.endsWith('\n')
          ? '\n'
          : '\n\n';
  const section = [GITIGNORE_HEADER, ...GITIGNORE_ENTRIES, ''].join('\n');

  try {
    fs.writeFileSync(gitignorePath, existing + separator + section, 'utf-8');
  } catch (err) {
    console.error(
      `[PortsSetupCommandInstaller] Failed to write ${gitignorePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
