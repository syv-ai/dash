# Dash

Desktop app for running [Claude Code](https://docs.anthropic.com/en/docs/claude-code) across multiple projects and tasks, each in its own git worktree.

The main idea: you open a project, create tasks, and each task gets an isolated git worktree with its own branch. Claude Code runs in a real terminal (xterm.js + node-pty) inside each worktree, so you can have multiple tasks going in parallel without branch conflicts.

## What it does

- **Project management** — Open any git repo as a project. Tasks are nested under projects in the sidebar.
- **Git worktrees** — Each task gets its own worktree and branch. A reserve pool pre-creates worktrees so new tasks start instantly (<100ms).
- **Terminal** — Full PTY terminal per task. Sessions persist when switching between tasks (state is snapshotted and restored). Shift+Enter sends multiline input. File drag-drop pastes paths.
- **File changes panel** — Real-time git status with staged/unstaged sections. Stage, unstage, discard per-file. Click to view diffs.
- **Diff viewer** — Full file or configurable context lines. Unified diff with syntax highlighting.
- **Customizable keybindings** — Remap any shortcut from Settings.
- **Dark/light theme**

## Install

Build and install locally:

```bash
git clone git@github.com:syv-ai/dash.git
cd dash
pnpm install
pnpm rebuild
./scripts/build-local.sh
```

This builds the app, ad-hoc signs it, and copies `Dash.app` to `/Applications`.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- Git

## Setup

```bash
pnpm install
pnpm rebuild  # rebuilds native modules (node-pty, better-sqlite3)
```

## Development

```bash
pnpm dev
```

This starts Vite on port 3000 and launches Electron pointing at it. Renderer changes hot-reload; main process changes need a restart (`pnpm dev:main` or just kill and re-run `pnpm dev`).

To just rebuild and launch the main process:

```bash
pnpm build:main
npx electron dist/main/main/entry.js --dev
```

## Build

```bash
pnpm build              # compile both main + renderer
pnpm package:mac        # build + package as macOS .dmg
```

Output goes to `release/`.

## Project structure

```
src/
├── main/                   # Electron main process
│   ├── entry.ts            # App name, path aliases, loads main.ts
│   ├── main.ts             # Boot: PATH fix, DB init, IPC, window
│   ├── preload.ts          # contextBridge API
│   ├── window.ts           # BrowserWindow creation
│   ├── db/                 # SQLite + Drizzle ORM
│   │   ├── schema.ts       # projects, tasks, conversations tables
│   │   ├── client.ts       # better-sqlite3 singleton
│   │   ├── migrate.ts      # SQL migration runner
│   │   └── path.ts         # DB file location
│   ├── ipc/                # IPC handlers
│   │   ├── appIpc.ts       # Dialogs, CLI detection
│   │   ├── dbIpc.ts        # CRUD for projects/tasks/conversations
│   │   ├── gitIpc.ts       # Git status, diff, stage/unstage
│   │   ├── ptyIpc.ts       # Terminal spawn/kill/resize
│   │   └── worktreeIpc.ts  # Worktree create/remove/claim
│   └── services/
│       ├── DatabaseService.ts
│       ├── GitService.ts
│       ├── FileWatcherService.ts
│       ├── WorktreeService.ts
│       ├── WorktreePoolService.ts
│       ├── ptyManager.ts
│       └── TerminalSnapshotService.ts
├── renderer/               # React UI
│   ├── App.tsx             # Root: state, keyboard shortcuts, layout
│   ├── keybindings.ts      # Keybinding system (defaults, load/save, matching)
│   ├── components/
│   │   ├── LeftSidebar.tsx  # Projects + nested tasks
│   │   ├── MainContent.tsx  # Terminal area
│   │   ├── FileChangesPanel.tsx
│   │   ├── DiffViewer.tsx
│   │   ├── TaskModal.tsx
│   │   ├── SettingsModal.tsx
│   │   └── TerminalPane.tsx
│   └── terminal/
│       ├── TerminalSessionManager.ts  # xterm.js lifecycle
│       └── SessionRegistry.ts         # Session pool (preserves state on task switch)
├── shared/
│   └── types.ts            # Shared types (Project, Task, GitStatus, etc.)
└── types/
    └── electron-api.d.ts   # window.electronAPI type declarations
```

## Default keybindings

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New task |
| `Cmd+Shift+K` | Next task |
| `Cmd+Shift+J` | Previous task |
| `Cmd+Shift+A` | Stage all |
| `Cmd+Shift+U` | Unstage all |
| `Cmd+,` | Settings |
| `Cmd+O` | Open folder |
| `Cmd+`` ` `` | Focus terminal |
| `Esc` | Close overlay |

All keybindings are customizable in Settings > Keybindings.

## Tech stack

| | |
|---|---|
| Shell | Electron 30 |
| UI | React 18, TypeScript, Tailwind CSS 3 |
| Build | Vite 5, pnpm |
| Terminal | xterm.js + node-pty |
| Database | SQLite (better-sqlite3) + Drizzle ORM |
| Package | electron-builder |

## Data storage

- **Database**: `~/Library/Application Support/Dash/app.db` (macOS)
- **Terminal snapshots**: `~/Library/Application Support/Dash/terminal-snapshots/`
- **Worktrees**: `{project}/../worktrees/{task-slug}/`

## Acknowledgements

Inspired by [emdash](https://github.com/generalaction/emdash).

## License

MIT
