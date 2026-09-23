# CLAUDE.md

## What is Dash

Electron desktop app for running Claude Code across multiple projects, each task in its own git worktree.

## Commands

Scripts live in `package.json`. The one that is not there:

```bash
npx electron-rebuild -f -w node-pty,better-sqlite3  # rebuild native modules for Electron
```

Renderer hot-reloads; main process changes require restart. Husky pre-commit runs lint-staged (Prettier + ESLint on staged `.ts`/`.tsx`).

### Native modules and test ABI

`better-sqlite3` and `node-pty` are native modules with one binary per Node ABI. Production runs under Electron's bundled Node (its own ABI); plain `node` has a different one. `pnpm test` runs vitest under Electron's Node via `ELECTRON_RUN_AS_NODE=1 electron …` so it uses the same binding as production. **Always rebuild for Electron** (`pnpm rebuild` or `npx electron-rebuild`) — never `npm rebuild` the native modules, which builds for the wrong ABI and breaks both dev and tests.

## Architecture

- `DASH_USER_DATA_DIR` and `DASH_DEV_URL` env vars point a second dev instance at its own data dir and Vite port (needed to run a checkout beside an installed Dash).
- Main-process specifics (task sessions under Claude Code's supervisor, per-worktree hooks) are in `src/main/CLAUDE.md`; renderer state rules are in `src/renderer/CLAUDE.md`. Both load when you work under those directories.
- **Add-ons** (ports, RTK) live in `src/main/addons/<id>/` and import only `@shared/addon-api` (lint-enforced); the host that runs them is `src/main/addonHost/`, and core never names an add-on. They show UI as data (blocks) in an optional settings section and an optional drawer in either sidebar. Design: `docs/specs/2026-09-23-addons.md`.
- Main process `entry.ts` rewrites the `@shared/*` and `@/*` path aliases at runtime: `@shared/*` → `dist/main/shared/*`, `@/*` → `dist/main/main/*`.

## Code Style

- **Tailwind CSS** for all styling; dark/light via class on root
- **Colors**: HSL CSS custom properties only (no raw hex/rgb). Tokens: `foreground`, `muted-foreground`, `background`, `surface-0..3`, `primary`, `destructive`, `border`, `git-added/modified/deleted/renamed/untracked/conflicted`
- **Faded text**: `text-muted-fade-N` / `text-fg-fade-N` / `fade-N`, never `text-muted-foreground/N`, `text-foreground/N` or `opacity-N` on text: they rescale the fade per theme so light stays readable. Glass edges/shadows likewise use `border-edge/N`, `shadow-shade/N`, `bg-scrim` and the `--glass-*` tokens, not white/black
- **Icons**: lucide-react, 14px default, stroke-width 1.8

## Data Storage

- **DB**: `~/Library/Application Support/Dash/app.db` (macOS) · `~/.config/Dash/app.db` (Linux)
- **Snapshots**: `~/Library/Application Support/Dash/terminal-snapshots/` (shell and service tabs only; agent panes repaint on attach)
- **Hook port file**: `~/Library/Application Support/Dash/hook-port` while Dash runs
- **Worktrees**: `{projectPath}/.claude/worktrees/{task-slug}-{hash}/` (excluded via `.git/info/exclude`; legacy `{projectPath}/../worktrees/` tasks are migrated by `WorktreeMigrationService`)

## Requirements

Claude Code CLI ≥ `MIN_CLAUDE_VERSION` (`src/main/services/claudeCli.ts`); task sessions refuse to start below it.
