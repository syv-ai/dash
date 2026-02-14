# CLAUDE.md

## What is Dash

Electron desktop app for running Claude Code across multiple projects, each task in its own git worktree. xterm.js + node-pty terminals, SQLite + Drizzle ORM, React 18 UI. macOS arm64 only.

## Commands

```bash
pnpm install              # install deps
pnpm rebuild              # rebuild native modules (node-pty, better-sqlite3)
pnpm dev                  # Vite on :3000 + Electron
pnpm dev:main             # main process only
pnpm dev:renderer         # Vite dev server only
pnpm build                # compile main (tsc) + renderer (vite)
pnpm type-check           # typecheck both processes
pnpm package:mac          # build + package as .dmg (arm64)
pnpm drizzle:generate     # generate Drizzle migrations
./scripts/build-local.sh  # build, sign, install to /Applications
```

Renderer hot-reloads; main process changes require restart. Husky pre-commit runs lint-staged (Prettier + ESLint on staged `.ts`/`.tsx`).

## Architecture

Two-process Electron app, strict context isolation (nodeIntegration disabled).

**Main** (`src/main/`): `entry.ts` → `main.ts` boots PATH fix, DB, hook server, IPC handlers, activity monitor, context usage service, status line script, window.

**Renderer** (`src/renderer/`): React SPA, all state in `App.tsx` (~930 lines, no Redux). Communicates via `window.electronAPI` (preload bridge, typed in `src/types/electron-api.d.ts`).

**IPC**: `electronAPI.method()` → `ipcRenderer.invoke()` → handler in `src/main/ipc/` → `IpcResponse<T>` `{ success, data?, error? }`. Fire-and-forget via `send()` for ptyInput/resize/kill/snapshot-save.

### Services (`src/main/services/`)

Stateless singletons with static methods:

| Service                   | Purpose                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DatabaseService`         | CRUD projects/tasks/conversations, upsert pattern, cascade deletes, linkedIssues as JSON                                                                                                                                       |
| `WorktreePoolService`     | Pre-creates reserve worktrees (<100ms task start). 30min expiry. Claims via `git worktree move` + `branch -m`                                                                                                                  |
| `WorktreeService`         | Create/remove worktrees, resolve base refs, copy preserved files (.env, .envrc, docker-compose.override.yml). Branch: `{slug}-{3char-hash}`                                                                                    |
| `ptyManager`              | Two spawn paths: direct Claude CLI (bypasses shell, minimal env) and shell (fallback). Configures `.claude/settings.local.json` hooks + statusLine. Writes `.git/info/exclude` entries for managed files. Reattaches on reload |
| `TerminalSnapshotService` | Persist terminal state to disk (8MB/snapshot, 64MB cap) at `~/Library/Application Support/Dash/terminal-snapshots/`                                                                                                            |
| `GitService`              | Status (porcelain v2), diff parsing into hunks/lines, stage/unstage/commit/push. 15s timeout, 1MB max diff. Filters `.claude/*`                                                                                                |
| `GithubService`           | `gh` CLI: issue search, branch linking via GraphQL, post branch comments. 15s timeout                                                                                                                                          |
| `HookServer`              | HTTP on `127.0.0.1:{random}`. `/hook/stop` → idle + notification, `/hook/busy` → busy, `/hook/context` → context usage update. Click-to-focus                                                                                  |
| `ContextUsageService`     | Tracks per-PTY context window usage (tokens, percentage). Receives data from HookServer, detects compaction (>30% drop with 5s reuse grace), broadcasts `pty:contextUsage` to renderer                                         |
| `ActivityMonitor`         | PTY busy/idle tracking. Direct spawns: hook-driven. Shell spawns: poll process tree (2s). Broadcasts `pty:activity`                                                                                                            |
| `FileWatcherService`      | Recursive `fs.watch`, 500ms debounce, ignores node_modules/.git. Sends `git:fileChanged`                                                                                                                                       |

### IPC Handlers (`src/main/ipc/`)

| File          | Handles                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `appIpc`      | Version, dialogs, openExternal, git/Claude detection, notification toggle                                        |
| `dbIpc`       | CRUD projects/tasks/conversations, archive/restore                                                               |
| `gitIpc`      | Status, diff, stage/unstage, discard, commit, push, branches, file watcher, clone                                |
| `ptyIpc`      | PTY start (direct+shell), input/resize/kill, snapshots, session detection, task context, activity, context usage |
| `worktreeIpc` | Create, remove, claim/ensure/check reserve                                                                       |
| `githubIpc`   | Check availability, search issues, get issue, branch comment, link branch                                        |

### Database (`src/main/db/`)

SQLite via better-sqlite3 + Drizzle ORM. WAL mode, 5s busy timeout, foreign keys ON. DB at `~/Library/Application Support/Dash/app.db`. Migrations run on startup.

**Tables** (cascade deletes: projects → tasks → conversations):

- `projects`: id, name, path (unique), git_remote, git_branch, base_ref, timestamps
- `tasks`: id, project_id (FK), name, branch, path, status, use_worktree, auto_approve, show_status_line, linked_issues (JSON), archived_at, timestamps
- `conversations`: id, task_id (FK), title, is_active, is_main, display_order, timestamps

### Renderer (`src/renderer/`)

**Layout** — 3-panel via `react-resizable-panels`:

- `LeftSidebar` — projects + nested tasks, activity indicators (busy=amber, idle=green), context usage bars + percentage
- `MainContent` — task header (name, branch, linked issues, context usage bar) + `TerminalPane`
- `FileChangesPanel` — staged/unstaged files, per-file actions, commit/push

**Terminal** (`terminal/`): `TerminalSessionManager` (~640 lines) manages xterm.js lifecycle, addons (Fit, Serialize, WebLinks, WebGL/Canvas fallback), snapshot save/restore (10s debounce), session restart overlay, Shift+Enter → Ctrl+J. `SessionRegistry` singleton prevents duplicates, coordinates themes, batch saves on quit.

**Modals**: `TaskModal` (name, worktree, base branch, issue picker, yolo mode, status line toggle) · `AddProjectModal` (folder or clone) · `DeleteTaskModal` (cleanup options) · `SettingsModal` (General/Keybindings/Connections tabs) · `DiffViewer` (line selection, inline comments → terminal)

**UI**: `IconButton` (default/destructive, sm/md) · `CircleCheck` (custom checkbox) · `Toast` (sonner wrapper)

**Utils**: `keybindings.ts` (defaults, load/save, matching) · `sounds.ts` (chime/cash/ping/droplet/marimba)

### Shared Types (`src/shared/types.ts`)

`Project`, `Task`, `Conversation`, `IpcResponse<T>`, `WorktreeInfo`, `ReserveWorktree`, `RemoveWorktreeOptions`, `PtyOptions`, `TerminalSnapshot`, `BranchInfo`, `FileChange`, `GitStatus`, `DiffResult`, `DiffHunk`, `DiffLine`, `ContextUsage`, `GithubIssue`

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
- See [docs/STYLEGUIDE.md](./docs/STYLEGUIDE.md) for full conventions

## Key Libraries

Electron 30, React 18, xterm.js 5 (fit/serialize/web-links/webgl/canvas addons), better-sqlite3 + drizzle-orm, Tailwind CSS 3, lucide-react, react-resizable-panels, sonner, @radix-ui (dialog/dropdown-menu/tooltip), clsx, tailwind-merge, class-variance-authority, Vite 5, TypeScript 5, electron-builder, ESLint 8, Prettier 3, Husky 9 + lint-staged.

## Data Storage

- **DB**: `~/Library/Application Support/Dash/app.db`
- **Snapshots**: `~/Library/Application Support/Dash/terminal-snapshots/`
- **Status script**: `~/Library/Application Support/Dash/dash-status.sh` (written once at startup, shared by all PTYs)
- **Worktrees**: `{projectPath}/../worktrees/{task-slug}/`
- **UI state**: localStorage (active project/task, theme, keybindings, panel states, notification prefs)

## CI/CD

GitHub Actions (`.github/workflows/build.yml`): triggers on `v*` tags + manual dispatch. Builds macOS arm64 DMG/ZIP, creates GitHub release.

## Requirements

Node.js 22+ (`.nvmrc`), pnpm (`shamefully-hoist` in `.npmrc`), Claude Code CLI, Git, macOS arm64.
