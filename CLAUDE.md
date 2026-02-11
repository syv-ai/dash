# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Dash

Dash is an Electron desktop app for running Claude Code across multiple projects, each task in its own git worktree. It uses xterm.js + node-pty for real terminals, SQLite + Drizzle ORM for persistence, and React 18 for the UI.

## Commands

```bash
pnpm install              # install dependencies
pnpm rebuild              # rebuild native modules (node-pty, better-sqlite3) for Electron
pnpm dev                  # start dev (Vite on :3000 + Electron)
pnpm dev:main             # rebuild and launch main process only
pnpm dev:renderer         # start Vite dev server only
pnpm build                # compile main (tsc) + renderer (vite)
pnpm type-check           # typecheck both main and renderer
pnpm package:mac          # build + package as macOS .dmg (arm64)
pnpm drizzle:generate     # generate Drizzle ORM migrations
```

Renderer changes hot-reload; main process changes require restarting `pnpm dev`.

## Architecture

Two-process Electron app with strict context isolation (nodeIntegration disabled).

**Main process** (`src/main/`): System operations — file I/O, git, PTY management, SQLite database. Entry point is `entry.ts` → `main.ts` which initializes PATH fix, database, IPC handlers, and creates the window.

**Renderer** (`src/renderer/`): React SPA. All state lives in `App.tsx` (no Redux or external state library). Communicates with main process exclusively through `window.electronAPI` (defined in `preload.ts`, typed in `src/types/electron-api.d.ts`).

**IPC pattern**: Renderer calls `window.electronAPI.someMethod()` → preload bridges to `ipcRenderer.invoke()` → main process handler in `src/main/ipc/` → returns `IpcResponse<T>` with `{ success, data?, error? }`.

**Services** (`src/main/services/`): Stateless singletons with static methods. Key services:

- `WorktreePoolService` — pre-creates reserve worktrees so new tasks start instantly
- `ptyManager` — spawns node-pty terminals, has a direct Claude CLI spawn path (bypasses shell)
- `TerminalSnapshotService` — persists terminal state to disk for recovery
- `GitService` — git status/diff using porcelain v2 format, 15s timeout on operations

**Database** (`src/main/db/`): SQLite via better-sqlite3 with Drizzle ORM. Schema: `projects` → `tasks` → `conversations` (cascade deletes). DB lives at `~/Library/Application Support/Dash/app.db`.

**Shared types** (`src/shared/types.ts`): Interfaces shared between main and renderer (Project, Task, GitStatus, etc.).

## Path Aliases

- `@/*` → `src/renderer/*` (renderer tsconfig)
- `@shared/*` → `src/shared/*` (both tsconfigs)

## Code Style

- Prettier: 2 spaces, single quotes, semicolons, trailing commas, 100-char width
- ESLint: `@typescript-eslint/no-explicit-any` is warn (not error); unused vars prefixed with `_` are allowed
- Tailwind CSS for all styling; dark/light theme via class on document root
- See [docs/STYLEGUIDE.md](./docs/STYLEGUIDE.md) for UI component conventions, color usage, and icon guidelines
