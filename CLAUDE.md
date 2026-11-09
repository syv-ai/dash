# CLAUDE.md

Electron app that runs Claude Code across projects, each task in its own git worktree. Renderer hot-reloads; main-process changes need a restart.

- **Native modules** (`better-sqlite3`, `node-pty`) must be built for Electron's Node ABI: `pnpm run rebuild` (the repo's script) or `npx electron-rebuild -f -w node-pty,better-sqlite3`. Never bare `pnpm rebuild` or `npm rebuild`: those are the package managers' own commands, which build for plain Node and break dev and `pnpm test` (which runs vitest under Electron's Node).
- **Data folders**: a dev run (unpackaged) uses `~/Library/Application Support/Dash-dev/`, the installed app `~/Library/Application Support/Dash/` (`app.db` there). A fresh dev folder starts with an empty DB; for real data, copy it over with `sqlite3 <Dash>/app.db ".backup '<Dash-dev>/app.db'"` (WAL mode: a plain `cp` while Dash runs can miss writes). A second dev instance beside the first: set `DASH_USER_DATA_DIR` (its own data dir) and `DASH_DEV_URL` (its Vite port).
- **Path aliases**: main's `entry.ts` rewrites `@shared/*` → `dist/main/shared/*` and `@/*` → `dist/main/main/*` at runtime.
- **Styling**: Tailwind, colors only as HSL tokens (no raw hex/rgb). Faded text uses `text-muted-fade-N` / `text-fg-fade-N` / `fade-N`, never `/N` opacity or `opacity-N` on text (the fade tokens keep light mode readable); glass edges use `border-edge/N`, `shadow-shade/N`, `bg-scrim`, not white/black. Icons: lucide-react, 14px, stroke-width 1.8.
- **Zustand**: a selector returning a derived array/object needs `useShallow`, or it re-renders forever.
