# CLAUDE.md

## What is Dash

Electron desktop app for running Claude Code across multiple projects, each task in its own git worktree. xterm.js + node-pty terminals, SQLite + Drizzle ORM, React 18 UI. macOS arm64, Linux x64.

## Commands

```bash
pnpm install              # install deps
npx electron-rebuild -f -w node-pty,better-sqlite3  # rebuild native modules for Electron
pnpm dev                  # Vite on :3000 + Electron
pnpm dev:main             # main process only
pnpm dev:renderer         # Vite dev server only
pnpm build                # compile main (tsc) + renderer (vite)
pnpm test                 # vitest under Electron's Node (ELECTRON_RUN_AS_NODE)
pnpm type-check           # typecheck both processes
pnpm package:mac          # build + package as .dmg (arm64)
pnpm package:linux        # build + package as .AppImage (x64)
pnpm drizzle:generate     # generate Drizzle migrations
```

Renderer hot-reloads; main process changes require restart. Husky pre-commit runs lint-staged (Prettier + ESLint on staged `.ts`/`.tsx`).

### Native modules and test ABI

`better-sqlite3` and `node-pty` are native modules with one binary per Node ABI. Production runs under Electron's bundled Node (its own ABI); plain `node` has a different one. `pnpm test` runs vitest under Electron's Node via `ELECTRON_RUN_AS_NODE=1 electron …` so it uses the same binding as production. **Always rebuild for Electron** (`pnpm rebuild` or `npx electron-rebuild`) — never `npm rebuild` the native modules, which builds for the wrong ABI and breaks both dev and tests.

## Architecture

Two-process Electron app, strict context isolation (nodeIntegration disabled).

- **Main** (`src/main/`): `entry.ts` → `main.ts` boots PATH fix, DB, hook server, IPC handlers, activity monitor, window.
- **Renderer** (`src/renderer/`): React SPA, all state in `App.tsx` (no Redux). Communicates via `window.electronAPI` (preload bridge, typed in `src/types/electron-api.d.ts`).
- **IPC**: `electronAPI.method()` → `ipcRenderer.invoke()` → handler in `src/main/ipc/` → `IpcResponse<T>` `{ success, data?, error? }`. Fire-and-forget via `send()` for ptyInput/resize/kill/snapshot-save.
- **Services** (`src/main/services/`): Stateless singletons with static methods.
- **Database** (`src/main/db/`): SQLite via better-sqlite3 + Drizzle ORM. WAL mode, foreign keys ON. Migrations run on startup. Tables: projects → tasks → conversations (cascade deletes).
- **Shared types**: `src/shared/types.ts`

## Path Aliases

- `@/*` → `src/renderer/*` (renderer tsconfig) or `src/main/*` (main tsconfig)
- `@shared/*` → `src/shared/*` (both tsconfigs)

Main process `entry.ts` rewrites at runtime: `@shared/*` → `dist/main/shared/*`, `@/*` → `dist/main/main/*`.

## Code Style

- **Prettier**: 2 spaces, single quotes, semicolons, trailing commas, 100-char width
- **ESLint**: `no-explicit-any` warn; `_` prefix unused vars allowed; `no-require-imports` off
- **Tailwind CSS** for all styling; dark/light via class on root
- **Colors**: HSL CSS custom properties only (no raw hex/rgb). Tokens: `foreground`, `muted-foreground`, `background`, `surface-0..3`, `primary`, `destructive`, `border`, `git-added/modified/deleted/renamed/untracked/conflicted`
- **Icons**: lucide-react, 14px default, stroke-width 1.8

## Data Storage

- **DB**: `~/Library/Application Support/Dash/app.db` (macOS) · `~/.config/Dash/app.db` (Linux)
- **Snapshots**: `~/Library/Application Support/Dash/terminal-snapshots/`
- **Worktrees**: `{projectPath}/../worktrees/{task-slug}/`
- **UI state**: localStorage (active project/task, theme, keybindings, panel states, notification prefs)

## Requirements

Node.js 22+ (`.nvmrc`), pnpm (`shamefully-hoist` in `.npmrc`), Claude Code CLI, Git. macOS arm64 or Linux x64.
