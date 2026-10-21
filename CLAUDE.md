# CLAUDE.md

Electron app that runs Claude Code across projects, each task in its own git worktree. Renderer hot-reloads; main-process changes need a restart.

- **Native modules** (`better-sqlite3`, `node-pty`) must be built for Electron's Node ABI: `pnpm run rebuild` (the repo's script) or `npx electron-rebuild -f -w node-pty,better-sqlite3`. Never bare `pnpm rebuild` or `npm rebuild`: those are the package managers' own commands, which build for plain Node and break dev and `pnpm test` (which runs vitest under Electron's Node).
- **Second dev instance** beside an installed Dash: set `DASH_USER_DATA_DIR` and `DASH_DEV_URL` (own data dir and Vite port). The installed app's data is `~/Library/Application Support/Dash/` (`app.db` there).
- **Path aliases**: main's `entry.ts` rewrites `@shared/*` → `dist/main/shared/*` and `@/*` → `dist/main/main/*` at runtime.
- **Styling**: Tailwind, colors only as HSL tokens (no raw hex/rgb). Faded text uses `text-muted-fade-N` / `text-fg-fade-N` / `fade-N`, never `/N` opacity or `opacity-N` on text (the fade tokens keep light mode readable); glass edges use `border-edge/N`, `shadow-shade/N`, `bg-scrim`, not white/black. Icons: lucide-react, 14px, stroke-width 1.8.
- **Zustand**: a selector returning a derived array/object needs `useShallow`, or it re-renders forever.
