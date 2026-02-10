# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Dash

Electron desktop app for running Claude Code across multiple projects/tasks, each in its own git worktree. Tasks get isolated worktrees with their own branches so multiple tasks can run in parallel without branch conflicts.

## Commands

```bash
pnpm install              # Install dependencies
pnpm rebuild              # Rebuild native modules (node-pty, better-sqlite3) for Electron
pnpm dev                  # Start dev (Vite on :3000 + Electron, renderer hot-reloads)
pnpm dev:main             # Rebuild & relaunch main process only
pnpm build                # Compile both main + renderer
pnpm build:main           # Compile main process only
pnpm build:renderer       # Build renderer with Vite
pnpm package:mac          # Build + package macOS .dmg (output in release/)
pnpm type-check           # TypeScript type check (no emit)
pnpm drizzle:generate     # Generate Drizzle ORM migrations
```

No test framework is configured. No lint script in package.json (ESLint/Prettier configs exist but must be run manually).

## Architecture

**Electron two-process model:**
- **Main process** (`src/main/`): Node.js — database, git, PTY management, file system. Compiled with `tsc` to CommonJS (`tsconfig.main.json`).
- **Renderer process** (`src/renderer/`): Browser — React UI, xterm.js terminals. Bundled with Vite (`tsconfig.json`).
- **IPC bridge**: `src/main/preload.ts` exposes `window.electronAPI` via `contextBridge`. Types in `src/types/electron-api.d.ts`.

**Main process layers:**
- `src/main/ipc/` — IPC handlers (one file per domain: app, db, git, pty, worktree). All registered in `ipc/index.ts`.
- `src/main/services/` — Business logic as singleton service classes (DatabaseService, GitService, WorktreeService, WorktreePoolService, ptyManager, FileWatcherService, TerminalSnapshotService).
- `src/main/db/` — SQLite via better-sqlite3 + Drizzle ORM. Schema defines `projects`, `tasks`, `conversations` tables. Migrations use raw SQL with `CREATE TABLE IF NOT EXISTS` + ALTER TABLE try-catch.

**Renderer layers:**
- `src/renderer/App.tsx` — Root component holding all app state, keyboard shortcuts, layout.
- `src/renderer/components/` — UI components (sidebar, terminal pane, file changes, diff viewer, modals).
- `src/renderer/terminal/` — xterm.js session management. `SessionRegistry` preserves terminal sessions across task switches. `TerminalSessionManager` handles xterm lifecycle.

**Shared types** live in `src/shared/types.ts`.

## Key patterns

- **Worktree pool**: `WorktreePoolService` pre-creates reserve worktrees in the background. Claiming one uses `git worktree move` + `git branch -m` (~100ms vs 2-5s full creation).
- **Terminal persistence**: Sessions stay alive in `SessionRegistry` when switching tasks. State is snapshotted every 2 minutes via `TerminalSnapshotService` for crash recovery.
- **Yolo mode**: Task creation can enable `--dangerously-skip-permissions` flag on the Claude CLI spawn.
- **Path aliases**: `@/` maps to `src/main/`, `@shared/` maps to `src/shared/` (main process). Renderer uses Vite aliases.

## Tech stack

- **Runtime**: Electron 30, Node 22, pnpm
- **UI**: React 18, TypeScript 5.3, Tailwind CSS 3, Radix UI primitives
- **Terminal**: xterm.js 5.3 + node-pty 1.0 (WebGL/Canvas/Software renderer fallback)
- **Database**: better-sqlite3 + Drizzle ORM
- **Packaging**: electron-builder (macOS arm64)

## Data storage (macOS)

- Database: `~/Library/Application Support/Dash/app.db`
- Terminal snapshots: `~/Library/Application Support/Dash/terminal-snapshots/`
- Worktrees: `{project}/../worktrees/{task-slug}/`
