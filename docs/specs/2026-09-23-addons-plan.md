# Add-ons implementation plan

**Goal:** Replace the wizard layer with the add-on system in
`docs/specs/2026-09-23-addons.md`, and rebuild RTK and port management as its
first two add-ons.
**Approach:** Three phases, each shippable on its own. Phase 1 builds the host,
API, storage and renderer surfaces (settings section, optional drawers in either
sidebar) with no add-ons registered; old ports/RTK code untouched. Phase 2 moves
RTK onto it and deletes the old RTK wiring. Phase 3 moves ports, turns its
onboarding into a drawer, then deletes the wizard/TUI machinery.
**Stack:** Electron main (TypeScript, CommonJS), better-sqlite3 + Drizzle, zod,
React + Zustand renderer, vitest under Electron's Node, ESLint flat config.

Written against `origin/main` at v0.16.12 (`b43d320`).

## 0. Working notes for the implementer

- Shell: node/pnpm are broken nvm wrappers in this environment. Before any
  command: `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:/opt/homebrew/bin:$PATH"; unset -f node npm npx pnpm nvm _load_nvm 2>/dev/null`.
  A fresh worktree needs `pnpm install` then
  `./node_modules/.bin/electron-rebuild -f -w node-pty,better-sqlite3` (never
  `npm rebuild`).
- Checks used below: `pnpm run type-check` (both tsconfigs), `pnpm test`
  (vitest, ~1,080 tests, ~12 s), `pnpm lint`.
- Tests are pure node (no jsdom). Main-side tests live in `__tests__/` next to
  the code. In-memory SQLite tests follow `src/main/services/__tests__/DrawerTabsService.test.ts`.
- Renderer behaviour is checked by hand in a second dev instance
  (`DASH_USER_DATA_DIR` + `DASH_DEV_URL`, see CLAUDE.md), never against the
  user's own Dash on port 3000.
- Every change landing on main bumps `package.json` `version` (CI tags releases).
- Commit per phase at minimum; per task is fine.

## 1. Ordering rule

An add-on replaces old code in one step: its files are _copied_ in while the old
code keeps running, it is built and tested against a fake `ctx`, and it is added
to `ADDONS` in the same task that deletes the old wiring (Task 11 for RTK,
Task 17 for ports). This keeps the lint boundary green throughout and never runs
old and new side by side.

## 2. File map

**New — API (shared, importable by add-ons and renderer)**

- `src/shared/addon-api/blocks.ts`: block types, zod schemas, builder functions.
- `src/shared/addon-api/index.ts`: `defineAddon`, `AddonContext`, `AddonSurfaces`,
  `TaskInfo`, `HookContribution`, re-exports blocks.

**New — host (main)**

- `src/main/addonHost/AddonHost.ts`: lifecycle, enable state, disposal, error
  isolation, surface evaluation, env/path/hook aggregation, event fan-out. Pure: takes `HostDeps`.
- `src/main/addonHost/hostDeps.ts`: `HostDeps` interface + production
  implementation over core services.
- `src/main/addonHost/addonStore.ts`: `addons` / `addon_data` table access and one-time imports.
- `src/main/addonHost/fileWatch.ts`: retrying directory watcher (generalised from `PortsConfigWatcher.ensureWatching`).
- `src/main/addonHost/registry.ts`: imports `ADDONS`, creates the singleton host.
- `src/main/ipc/addonsIpc.ts`: IPC handlers.
- `src/main/addons/index.ts`: `export const ADDONS: Addon[] = [...]`.

**New — renderer**

- `src/types/electron-api/addons.ts`: `AddonsApi` type.
- `src/renderer/stores/addonsStore.ts`: fetched list + surfaces cache.
- `src/renderer/components/addons/AddonBlocks.tsx`: block → `ui/` primitive renderer.
- `src/renderer/components/addons/AddonSettingsSection.tsx`: Settings → Add-ons content.
- `src/renderer/components/addons/AddonDrawer.tsx`: one collapsible drawer (header: title, summary, icon actions; body: blocks). Generalised from `rightInspector/PortsDrawer.tsx`.
- `src/renderer/components/addons/AddonDrawerStack.tsx`: all drawers for one side; used in both sidebars.

**Phase 2 (RTK), copied in Task 9, originals deleted in Task 11** → `src/main/addons/rtk/`:
`RtkService.ts` split into `binary.ts` (resolve, symlink), `download.ts`,
`hookTest.ts`, plus `index.ts` (the add-on). Tests `rtk-unit.test.ts`,
`rtk-integration.test.ts` are copied to `src/main/addons/rtk/__tests__/`.

**Phase 3 (ports), copied in Task 12, originals deleted in Task 17** → `src/main/addons/ports/`:
`WorkspacePortsService.ts`, `WorkspacePortsRuntime.ts`, `PortAllocator.ts`,
`PortLivenessService.ts`, `PortsHeuristic.ts`, `PortsSetupPrompt.ts`,
`ServiceRunner.ts`, `derivedEnv.ts`, `relevance.ts`, plus new `setup.ts`,
`drawer.ts`, `index.ts`. Their tests are copied to `src/main/addons/ports/__tests__/`.

**Deleted (Phase 2/3)**: see Tasks 11 and 17.

## Phase 1 — the host

### Task 1: Add-on API and blocks

**Files:** create `src/shared/addon-api/blocks.ts`, `src/shared/addon-api/index.ts` · test `src/shared/addon-api/__tests__/blocks.test.ts`

**Behaviour:** add-ons and the host share one typed contract; `BlockSchema`
accepts every block in spec §3.4 and rejects unknown types, unknown icons and
missing required fields; `DrawerSchema` validates a drawer.

```ts
// blocks.ts (shape; zod schemas mirror these)
export const ICONS = [
  'play',
  'square',
  'scroll-text',
  'external-link',
  'copy',
  'refresh-cw',
  'x',
] as const;
export type IconAction = { id: string; icon: (typeof ICONS)[number]; tooltip: string };
export type Block =
  | { type: 'text'; text: string; tone?: 'muted' | 'error' | 'success' }
  | {
      type: 'row';
      label: string;
      meta?: string;
      status?: 'up' | 'down' | 'unknown';
      tooltip?: string;
      onClick?: string;
      actions?: IconAction[];
    }
  | { type: 'list'; rows: Extract<Block, { type: 'row' }>[] }
  | { type: 'button'; id: string; label: string; primary?: boolean; busy?: boolean }
  | { type: 'progress'; value?: number; label?: string }
  | { type: 'code'; text: string; label?: string };
export type Drawer = { title: string; summary?: string; actions?: IconAction[]; blocks: Block[] };
// builders: text(), row(), list(), button(), progress(), code(), iconAction()

// index.ts
export interface TaskInfo {
  id: string;
  projectId: string;
  name: string;
  path: string;
  archived: boolean;
}
export type StorageScope = 'global' | { project: string } | { task: string };
export interface HookContribution {
  event: 'PreToolUse';
  matcher: string;
  command: string;
}
export type SurfaceRef = { surface: 'settings' | 'drawer'; taskId?: string };
export interface AddonSurfaces {
  settings?(): Block[];
  drawer?(task: TaskInfo | null): Drawer | null;
  onAction?(ref: SurfaceRef, actionId: string): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
export interface TerminalHandle {
  key: string;
  tabId: string;
}
export interface AddonContext {
  session: {
    env(fn: (wt: { path: string; taskId: string | null }) => Record<string, string>): void;
    path(fn: () => string[]): void; // dirs prepended to PATH
    hooks(fn: () => HookContribution[]): void;
  };
  on(event: 'taskCreated' | 'taskDeleted', fn: (task: TaskInfo) => void): void;
  storage: {
    get<T>(scope: StorageScope, key: string): T | undefined;
    set(scope: StorageScope, key: string, value: unknown): void;
    delete(scope: StorageScope, key: string): void;
    list<T>(scopeKind: 'project' | 'task', key: string): Array<{ scopeId: string; value: T }>;
  };
  tasks: {
    get(taskId: string): TaskInfo | undefined;
    list(): TaskInfo[];
    create(opts: { projectId: string; name: string; initialPrompt?: string }): Promise<TaskInfo>;
    activate(taskId: string): void;
    restartSessions(taskId: string): void;
    refreshHooks(): Promise<void>;
  };
  terminals: {
    run(
      taskId: string,
      opts: {
        key: string;
        label: string;
        command: string;
        cwd?: string;
        env?: Record<string, string>;
        onExit?: () => void;
        onClosed?: () => void;
      },
    ): Promise<TerminalHandle>;
    stop(taskId: string, key: string): void;
    isRunning(taskId: string, key: string): boolean;
    focus(taskId: string, key: string, opts?: { reset?: boolean }): void;
  };
  files: { watch(taskId: string, relDir: string, fn: () => void): void };
  notify: {
    toast(t: {
      kind: 'info' | 'success' | 'warning' | 'error';
      title: string;
      body?: string;
    }): void;
  };
  shell: { openUrl(url: string): void; copy(text: string): void };
  paths: { data: string };
  setInterval(fn: () => void, ms: number): void;
  log: Pick<Console, 'info' | 'warn' | 'error'>;
  refresh(): void;
}
export interface Addon {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  drawerSide?: 'left' | 'right'; // default 'right'; only meaningful with a drawer surface
  activate(ctx: AddonContext): AddonSurfaces | Promise<AddonSurfaces>;
}
export function defineAddon(a: Addon): Addon {
  return a;
}
```

- [ ] Write failing tests: valid samples of each block and a drawer parse; `{type:'html'}`, `icon:'bomb'`, `row` without `label`, drawer without `title` fail
- [ ] Implement
- [ ] Verify: `pnpm test src/shared/addon-api` → passes; `pnpm run type-check` → clean

### Task 2: Storage tables and `addonStore`

**Files:** modify `src/main/db/migrate.ts` (call before `rawDb.pragma('foreign_keys = ON')`, ~line 349), `src/main/db/schema.ts` (append) · create `src/main/addonHost/addonStore.ts` · test `src/main/addonHost/__tests__/addonStore.test.ts`

**Behaviour:** two tables exist; the store reads/writes enable state and
scoped JSON values; deleting a task or project scope removes its rows.

```sql
CREATE TABLE IF NOT EXISTS addons (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS addon_data (
  addon_id TEXT NOT NULL, scope TEXT NOT NULL,      -- 'global' | 'project' | 'task'
  scope_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (addon_id, scope, scope_id, key));
```

`addonStore` exports `createAddonStore(db: Database)` with `getEnabled(id)`
(`undefined` when no row), `setEnabled`, `get/set/delete/list` matching
`AddonContext.storage`, and `deleteScope(scope, scopeId)`. The DDL lives in an
exported `ensureAddonTables(db)` that `runMigrations` calls, so tests can run it
against `new Database(':memory:')`.

- [ ] Write failing tests: set/get round-trip per scope; `list('task', 'ports')` returns all tasks' values; `deleteScope('task', id)` removes only that task's rows; `getEnabled` undefined when unset
- [ ] Implement; call `ensureAddonTables(rawDb)` from `runMigrations`
- [ ] Verify: `pnpm test src/main/addonHost` → passes

### Task 3: `AddonHost`

**Files:** create `src/main/addonHost/AddonHost.ts` · test `src/main/addonHost/__tests__/AddonHost.test.ts`

**Behaviour:** given `Addon[]`, a store and `HostDeps` (all fakeable), the host:

- `start()` activates every enabled add-on (enabled = store row, else `defaultEnabled`) in parallel, each capped at 10 s; a throw or timeout sets status `failed` with the message; resolves when all have settled.
- Wraps every `ctx` registration (`on`, `session.env/path/hooks`, `files.watch`, `terminals.run`, `setInterval`) so `disable(id)` undoes all of them, calls `dispose()`, drops surfaces, then calls `deps.refreshHooks()` and emits `changed(id)`.
- `setEnabled(id, bool)` persists and activates/disables live. When the add-on has env or path contributions, calls `deps.notifyEnvChanged(id)`.
- `envFor({path, taskId})` merges every active add-on's env in `ADDONS` order, dropping keys in core's `RESERVED_ENV_KEYS` (export that set from `claudeEnv.ts` and pass it in via deps); a throwing contributor is logged and skipped.
- `pathDirs()` concatenates `session.path` results, de-duplicated; `hookEntries()` concatenates hook results; throwing contributors skipped.
- `emit(event, task)` calls listeners; each listener's throw is caught and logged.
- `list()` returns `{id, name, description, enabled, status, error?, hasDrawer, drawerSide}` (`hasDrawer` = active and surfaces include `drawer`).
- `surfacesFor(taskId | null)` returns, per active add-on, `{addonId, settings?, drawer?}` where each value is the validated result or `{error: message}`; `drawer` is omitted when the add-on has no drawer surface or it returns `null`.
- `action(addonId, ref, actionId)` awaits `onAction`; errors → `deps.toast` + log.
- `ctx.refresh()` → `deps.emitChanged(addonId)`, debounced 50 ms per add-on.
- `stop()` disables all (quit).

- [ ] Write failing tests for each bullet with fake add-ons (one with a drawer, one without) and fake deps
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addonHost/__tests__/AddonHost.test.ts` → passes

### Task 4: Production `HostDeps`

**Files:** create `src/main/addonHost/hostDeps.ts`, `src/main/addonHost/fileWatch.ts` · test `src/main/addonHost/__tests__/fileWatch.test.ts`

**Behaviour:** each `ctx` capability is backed by real core services:

| ctx                                | Backed by                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.get/list`                   | `DatabaseService.getTask` / every project's tasks → `TaskInfo` (`archived = archivedAt != null`)                                                                                                                                                                                                                                                                          |
| `tasks.create`                     | The steps of `handleMigrate` in `src/main/wizard/ports/index.ts:103-150`: `worktreeService.createWorktree(project.path, name, {projectId, pushRemote:false})`, `DatabaseService.saveTask({… useWorktree:true, branchCreatedByDash:true})`, `setInitialPrompt(task.id, prompt)` when given, host `emit('taskCreated')`, then send `addons:taskCreated {taskId, projectId}` |
| `tasks.activate`                   | send `addons:activateTask {taskId, projectId}`                                                                                                                                                                                                                                                                                                                            |
| `tasks.restartSessions`            | send `addons:restartTask taskId` (renderer calls `sessionRegistry.restartAllForTask`, as `App.tsx:416-421` does today)                                                                                                                                                                                                                                                    |
| `tasks.refreshHooks`               | `refreshActivePtyHooks()` (`ptyManager.ts:150-175`); failures → toast                                                                                                                                                                                                                                                                                                     |
| `terminals.*`                      | The spawn path in `src/main/ipc/servicesIpc.ts:73-106`: `DrawerTabsService.add(taskId, {kind:'service', featureId: addonId, label, id})` with id `svc:<addonId>:<taskId>:<slug(key)>`, clear the snapshot, `startCommandPty({kind:'service', …})`, `killPty`, `hasPty`; `focus` sends `addons:focusTab {taskId, tabId, reset}`                                            |
| `files.watch`                      | `fileWatch.ts`: `fs.watch(path.join(taskPath, relDir))`, debounced 150 ms; if the dir doesn't exist, retry every 2 s until it does; returns a disposer                                                                                                                                                                                                                    |
| `notify.toast`                     | `webContents.send('app:toast', …)` (existing channel)                                                                                                                                                                                                                                                                                                                     |
| `shell.openUrl/copy`               | `shell.openExternal` (http/https only) / `clipboard.writeText`                                                                                                                                                                                                                                                                                                            |
| `paths.data`                       | `<userData>/addons/<id>/`, created on first access                                                                                                                                                                                                                                                                                                                        |
| `emitChanged` / `notifyEnvChanged` | `webContents.send('addons:changed', {addonId})` / `('addons:envChanged', {addonId})`                                                                                                                                                                                                                                                                                      |

The sender comes from `setSender(webContents)` like other services (call it in
`main.ts` next to the existing `setSender` calls, ~150-170 and in the `activate`
handler ~270-290).

- [ ] Write failing test for `fileWatch`: watching a missing dir, then creating it and a file in it, fires the callback (temp dir)
- [ ] Implement `fileWatch.ts` and `hostDeps.ts`
- [ ] Verify: `pnpm test src/main/addonHost` → passes; `pnpm run type-check` → clean

### Task 5: Registry and core call sites

**Files:** create `src/main/addons/index.ts` (`export const ADDONS: Addon[] = []`), `src/main/addonHost/registry.ts` · modify `src/main/services/claudeEnv.ts:32-40,86-91,160-170`, `src/main/services/ptyManager.ts:566-574`, `src/main/services/ptyHookSettings.ts:71-80`, `src/main/ipc/dbIpc.ts:63-110` and its project-delete handler, `src/main/main.ts` (boot ~165-186, quit ~304-392)

**Behaviour:** core calls the host at these points, next to (not yet replacing)
the existing ports/RTK code:

- `buildClaudeEnv`: after the ports merge, merge `addonHost.envFor({path: cwd, taskId})`; prepend `addonHost.pathDirs()` to `PATH` with `prependUnique` (beside the RTK prepend at `:86-91`, which Task 11 removes). Export `RESERVED_ENV_KEYS`.
- Shell PTY env in `ptyManager`: the same env merge and `PATH` prepend after the ports loop.
- `buildPreToolUseHooks`: append `addonHost.hookEntries()` as `{matcher, hooks:[tagDash({type:'command', command})]}`.
- `db:saveTask` (new worktree task) → `emit('taskCreated', info)`; `db:deleteTask` → `emit('taskDeleted', info)` **before** `DatabaseService.deleteTask`, then `store.deleteScope('task', id)`; project delete → `deleteScope('project', id)`.
- `main.ts`: `await addonHost.start()` right after the RTK warm-up block, before any PTY can spawn; `addonHost.stop()` in the quit sequence before `killAll`.

- [ ] Implement
- [ ] Verify: `pnpm run type-check`, `pnpm test` → clean/passing; a dev instance behaves as before, no console errors

### Task 6: IPC, preload, types

**Files:** create `src/main/ipc/addonsIpc.ts`, `src/types/electron-api/addons.ts` · modify `src/main/ipc/index.ts`, `src/main/preload.ts`, `src/types/electron-api.d.ts`

**Behaviour:** zod-validated channels:

| Channel                                                                                                                     | Kind          | Payload → result                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| `addons:list`                                                                                                               | invoke        | → host `list()`                                                    |
| `addons:setEnabled`                                                                                                         | invoke        | `{id, enabled}`                                                    |
| `addons:surfaces`                                                                                                           | invoke        | `{taskId: string \| null}` → host `surfacesFor`                    |
| `addons:action`                                                                                                             | invoke        | `{addonId, ref, actionId}`                                         |
| `addons:terminalClosed`                                                                                                     | invoke        | `{taskId, tabId}` → the owning `terminals.run` handle's `onClosed` |
| `addons:changed`, `addons:envChanged`, `addons:taskCreated`, `addons:activateTask`, `addons:restartTask`, `addons:focusTab` | main→renderer | as in Task 4                                                       |

- [ ] Write failing tests (style of `src/main/ipc/__tests__/validate.test.ts`) for the schemas: bad `ref.surface`, missing `addonId` rejected
- [ ] Implement; register in `ipc/index.ts`; preload keys `addonsList`, `addonsSetEnabled`, `addonsSurfaces`, `addonsAction`, `addonsTerminalClosed`, `onAddonsChanged`, `onAddonsEnvChanged`, `onAddonsTaskCreated`, `onAddonsActivateTask`, `onAddonsRestartTask`, `onAddonsFocusTab`
- [ ] Verify: `pnpm run type-check`, `pnpm test` → clean/passing

### Task 7: Renderer: settings section and drawers

**Files:** create `src/renderer/stores/addonsStore.ts` and the four files under `src/renderer/components/addons/` · modify `src/renderer/stores/settingsKeys.ts` (add `addonDrawerSide: Record<string,'left'|'right'>` and `addonDrawerCollapsed: Record<string, boolean>` to `SETTINGS_REGISTRY`), `src/renderer/components/settings/SettingsModal.tsx` (add-ons tab `:1495-1530`; move `AddOnAccordion` `:1746` into `AddonSettingsSection.tsx`), `src/renderer/App.tsx` (right inspector wrapper `:1303-1351`; task listeners `:412-437`), `src/renderer/components/leftSidebar/LeftSidebar.tsx` (above `<UpdateBanner />` `:314`), `src/renderer/components/terminal/TerminalTabs.tsx` (tab close `:340-349`, focus listener `:260-275`)

**Behaviour:**

- `addonsStore`: `list`, `surfaces` for the active task (and `null` task for settings); `load()`; refetch on `onAddonsChanged`, on active-task change and after `setEnabled`; `action()`, `setEnabled()`.
- `AddonBlocks` renders blocks with existing primitives: `row`/`list` like `rightInspector/PortsPanel.tsx` rows (status dot classes `:17-21`, `Tooltip`, `IconButton`); `button` → `Button`; `progress` → `ProgressBar`; `code` → `<pre>` in a `surface-1` box; `text` tones via `text-muted-fade-*` / `destructive` / `git-added`. An `{error}` surface renders one error line.
- Settings → Add-ons: one `AddOnAccordion` per add-on: name, description, status, a `Switch` for enabled, a Left/Right `Segmented` control **only when `hasDrawer`** (writes `addonDrawerSide[id]`, default the add-on's `drawerSide`), then its `settings` blocks; a `failed` add-on shows its error. The existing RTK accordion stays until Task 11.
- `AddonDrawer`: collapsible like `PortsDrawer.tsx` (header with chevron, title, summary, icon actions; body `AddonBlocks`); collapse state in `addonDrawerCollapsed[id]`. `AddonDrawerStack side="left|right"` renders the drawers whose resolved side matches and whose `drawer` surface is present for the active task; renders nothing when there are none.
- Right sidebar: `AddonDrawerStack side="right"` stacked with the right inspector the way `PortsDrawerWrapper` does today (keep `PortsDrawerWrapper` until Task 17). Left sidebar: `AddonDrawerStack side="left"` above `UpdateBanner`, only in the expanded sidebar.
- App: handle `onAddonsTaskCreated` (as `App.tsx:430-437`: `loadTasksForProject`, then set active project and task), `onAddonsActivateTask`, `onAddonsRestartTask` (`sessionRegistry.restartAllForTask`), `onAddonsEnvChanged` (toast "Restart sessions to apply" with an action restarting the active task).
- TerminalTabs: closing a `service` tab whose `featureId` is not `'ports'` calls `addonsTerminalClosed`; `onAddonsFocusTab` behaves like `onPortsServiceFocusTab` (`:260-275`).

- [ ] Implement
- [ ] Verify: `pnpm run type-check`, `pnpm lint` → clean. Manual, with a throwaway local add-on (not committed) that has a settings button and a drawer with two rows and a button: both render; actions reach main; switching its side in Settings moves the drawer between sidebars; an add-on without a drawer shows no side picker and no drawer; disabling removes everything without restart; a throwing drawer shows an error line only there

### Task 8: Lint boundary

**Files:** modify `eslint.config.mjs`

**Behaviour:** three `no-restricted-imports` blocks per spec §2:

- `files: ['src/main/addons/*/**']`: forbid `@/*`, `@shared/*` except `@shared/addon-api*`, `../../*` (leaving the add-on folder), `electron`.
- `files: ['src/main/**']`, ignoring `src/main/addons/**` and `src/main/addonHost/registry.ts`: forbid `@/addons/*` and `**/addons/*` (the renderer's `components/addons/` is outside `src/main`, so it is unaffected).
- `files: ['src/shared/addon-api/**']`: forbid `@/*`, `**/main/**`, `**/renderer/**`.

- [ ] Implement
- [ ] Verify: a temporary `import { DatabaseService } from '@/services/DatabaseService'` in a file under `src/main/addons/` makes `pnpm lint` fail; removing it passes

**Phase 1 done when:** type-check, tests and lint pass and a dev instance
behaves as before. Commit and bump the version.

## Phase 2 — RTK as an add-on

### Task 9: Copy RTK into `src/main/addons/rtk/`

**Files:** copy `src/main/services/RtkService.ts` → split into `src/main/addons/rtk/{binary.ts,download.ts,hookTest.ts}`; copy the RTK types (`src/shared/types.ts:726-802`) into `src/main/addons/rtk/types.ts`; copy tests to `src/main/addons/rtk/__tests__/`. Originals stay until Task 11.

**Behaviour:** the copied RTK logic has no `electron` import: functions take
`dataDir` (= `ctx.paths.data`) instead of `app.getPath('userData')`. The managed
binary lives at `<dataDir>/bin/rtk`. The `~/.local/bin/rtk` symlink logic
(`RtkService.ts:145-158`) is kept. Download reports progress through a callback.

- [ ] Copy tests, adjust imports (fail)
- [ ] Split and adapt the code (pass)
- [ ] Verify: `pnpm test src/main/addons/rtk` → passes; `pnpm lint` → no boundary errors

### Task 10: The RTK add-on

**Files:** create `src/main/addons/rtk/index.ts` · test `src/main/addons/rtk/__tests__/rtkAddon.test.ts` (not yet in `ADDONS`)

**Behaviour:**

- `defaultEnabled: false`, no `drawer`. `activate`: if `<userData>/bin/rtk` (old location) exists and `<dataDir>/bin/rtk` doesn't, move it and repoint the `~/.local/bin/rtk` symlink; then resolve the binary (managed first, then `$PATH`, probed with `--version`, as `RtkService.ts:164-203`).
- `session.path`: `[binDir]` when the binary is managed, else `[]`.
- `session.hooks`: `[{event:'PreToolUse', matcher:'Bash', command:"'<bin>' hook claude"}]` when a binary is resolved, else `[]`.
- `settings()`: status `text` (version + source, or "Not installed"), `button('install', 'Install RTK' | 'Update')` with `busy` and a `progress` block while downloading, `button('test', 'Test RTK')`, after a test a `code` block with the tested command and before/after output (or the error), and a `text` line linking github.com/rtk-ai/rtk.
- `onAction('install')`: download, re-resolve, `ctx.tasks.refreshHooks()`, `ctx.refresh()`; errors → `ctx.notify.toast`, previous binary kept. `onAction('test')`: run `hookTest`, keep the result in memory, refresh.

- [ ] Write failing tests (fake `ctx`): no binary → no hooks, no path; managed binary → quoted hook command and `[binDir]`; settings blocks per state; failed install toasts and keeps the old binary
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/rtk` → passes

### Task 11: Switch to the RTK add-on and remove the old wiring

**Files:** modify `src/main/addons/index.ts` (`[rtk]`) · delete `src/main/ipc/rtkIpc.ts`, `src/types/electron-api/rtk.ts`, `src/main/services/RtkService.ts`, `src/main/services/__tests__/rtk-{unit,integration}.test.ts`, RTK types in `src/shared/types.ts:726-802` · modify `src/main/ipc/index.ts:9,32`, `src/main/preload.ts:426-440`, `src/types/electron-api.d.ts:12,45`, `src/main/main.ts:165-170,279-280`, `src/main/services/claudeEnv.ts:2,86-91`, `src/main/services/ptyHookSettings.ts:5,75-78`, `src/main/services/ptyManager.ts:147` (comment), `src/renderer/stores/runtimeStore.ts` (RTK state, actions, init), `src/renderer/components/settings/SettingsModal.tsx` (RTK imports `:53-55`, selectors `:759-762`, RTK accordion `:1497-1529`, `RtkStatusCardBody`, `labelForProgress`, `RtkSection`, `RtkTestResultCard`), `src/main/addonHost/addonStore.ts` (one-time import)

**Behaviour:** RTK exists only as an add-on. On first boot after upgrade, if
`<userData>/rtk-config.json` has `enabled: true` and no `addons` row for `rtk`
exists, insert `rtk → enabled`; then delete the file. Core files contain no `rtk`.

- [ ] Write failing test for the one-time import in `addonStore.test.ts`
- [ ] Implement the deletions, edits and import
- [ ] Verify: `grep -rni "rtk" src/main/services src/main/ipc src/main/main.ts src/renderer/stores src/renderer/components/settings/SettingsModal.tsx` → no matches; `pnpm run type-check`, `pnpm test`, `pnpm lint` → clean
- [ ] Manual (dev instance): Settings → Add-ons → RTK off by default and without a side picker; enable, Install, Test shows a rewritten `git status`; in a task session `git status` output is compressed; the worktree's `.claude/settings.local.json` has the Bash `PreToolUse` entry; disable → the entry is gone without restart

**Phase 2 done when:** checks and the manual RTK check pass. Commit and bump the version.

## Phase 3 — ports as an add-on

### Task 12: Copy the ports services

**Files:** copy (originals stay until Task 17) `WorkspacePortsService.ts`, `WorkspacePortsRuntime.ts`, `PortAllocator.ts`, `PortLivenessService.ts`, `PortsHeuristic.ts`, `PortsSetupPrompt.ts`, `ServiceRunner.ts`, `derivedEnv.ts` from `src/main/services/` and `src/main/wizard/ports/relevance.ts` → `src/main/addons/ports/`; copy their tests (`PortAllocator`, `PortsHeuristic`, `ServiceRunner`, `WorkspacePortsService`, `derivedEnv`, `exportPipeline`) → `src/main/addons/ports/__tests__/`; copy the `TaskPort`/`PortLiveness` types from `src/shared/types.ts` into `src/main/addons/ports/types.ts`

**Behaviour:** the copies compile inside the lint boundary:

- `WorkspacePortsRuntime` takes a `PortsStore` (`get(taskId)`, `set(taskId, ports)`, `takenHostPorts(excludeTaskId)`) instead of `DatabaseService`. The production `PortsStore` uses task-scoped storage key `'ports'`; `takenHostPorts` = `ctx.storage.list('task','ports')` filtered to tasks where `ctx.tasks.get(id)?.archived === false` (replaces `DatabaseService.getTakenHostPorts`, `DatabaseService.ts:550-561`).
- `ServiceRunner`'s `RunnerDeps` drawer-tab/PTY members are implemented over `ctx.terminals`; `exec`, `lsofPids`, `killPid` stay in the add-on (Node `child_process`); `notifyChanged` → `ctx.refresh()`; `focusTab` → `ctx.terminals.focus`.
- `PortLivenessService` runs on `ctx.setInterval` and calls `ctx.refresh()` on change instead of sending `ports:liveness`.
- Nothing in core imports the copies.

- [ ] Copy tests, adjust imports (fail); adapt code (pass)
- [ ] Verify: `pnpm test src/main/addons/ports` → passes; `pnpm lint` → no boundary errors

### Task 13: Setup state

**Files:** create `src/main/addons/ports/setup.ts` · test `src/main/addons/ports/__tests__/setup.test.ts`

**Behaviour:** a pure reducer replaces `PortsOnboardingWizard` and
`PortsSetupWizard`. It holds only setup progress; "configured" and "not
configured" are read from the filesystem, not stored.

```ts
type Setup =
  | { kind: 'creating' } // source task, after Start setup
  | { kind: 'started'; setupTaskId: string } // source task, setup task exists
  | { kind: 'create-failed'; message: string } // source task
  | { kind: 'waiting'; since: number; errors?: string[] } // setup task
  | { kind: 'allocated'; count: number } // setup task
  | { kind: 'timed-out' }; // setup task
type Event =
  | { type: 'start' }
  | { type: 'created'; setupTaskId: string }
  | { type: 'createFailed'; message: string }
  | { type: 'setupTaskBorn'; now: number }
  | { type: 'config'; count: number }
  | { type: 'configError'; errors: string[] }
  | { type: 'tick'; now: number }
  | { type: 'restart' }
  | { type: 'dismiss' };
export function next(s: Setup | null, ev: Event): { setup: Setup | null; effects: Effect[] };
// Effect: 'createSetupTask' | 'restartSessions' | 'toastAllocated'
```

Rules: `null` + `start` → `creating` + `createSetupTask`; `creating` + `created`
→ `started`; `creating` + `createFailed` → `create-failed`; `setupTaskBorn` →
`waiting`; `waiting` + `configError` → `waiting` with errors; `waiting` +
`config` → `allocated` + `toastAllocated`; `waiting` + `tick` more than 30 min
after `since` → `timed-out`; `allocated` + `restart` → `null` + `restartSessions`;
`dismiss` on `started`, `create-failed`, `allocated` or `timed-out` → `null`;
anything else leaves the state unchanged with no effects.

- [ ] Write failing tests for each rule, including ignored events
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/ports/__tests__/setup.test.ts` → passes

### Task 14: The ports drawer

**Files:** create `src/main/addons/ports/drawer.ts` · test `src/main/addons/ports/__tests__/drawer.test.ts`

**Behaviour:** `buildDrawer(input) → Drawer`, a pure function of
`{configured: boolean, heuristic: {signals, guesses}, setup: Setup | null, setupTaskName?, ports, liveness, owned}`:

- `setup` set → progress/result view: `creating` → progress "Creating the port-setup task…"; `started` → text "Setup is running in task <name>" + `button('open-setup','Open task')` + `button('dismiss','Hide')`; `create-failed` → error text + `button('start','Try again')`; `waiting` → progress "Waiting for the agent to write .dash/ports.json" + error lines; `allocated` → "Allocated N ports" + `button('restart','Restart sessions', primary)`; `timed-out` → error text "The agent didn't write .dash/ports.json within 30 minutes." + `button('dismiss','Hide')`.
- not configured → text listing detected signals and guessed services (or a short explanation when none) + `button('start','Start setup', primary)`.
- configured → title "Ports", summary `"<up>/<total> up"`, header actions `run-all`, `stop-all`, `refresh` shown under the conditions in `usePortsState.ts` (`anyRunnable`, `allRunnableUp`, `anyRunning`), and a `list` of rows: label, meta `:<hostPort>`, status (running when owned, per `PortsPanel.tsx:59-83`), tooltip `"<label> · <source label> · $ENV · <status>"`, `onClick` `open:<label>`, actions `run:<label>` or `stop:<label>`, and `logs:<label>`.
- Title is always "Ports".

- [ ] Write failing tests with fixed inputs for each state, comparing whole drawer objects
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/ports/__tests__/drawer.test.ts` → passes

### Task 15: The ports add-on

**Files:** create `src/main/addons/ports/index.ts` · test `src/main/addons/ports/__tests__/portsAddon.test.ts` (not yet in `ADDONS`)

**Behaviour:** wires Tasks 12–14 to `ctx`:

- `defaultEnabled: true`, `drawerSide: 'right'`. Setup state in task-scoped storage key `'setup'`.
- `drawer(task)`: `null` when `task` is null or not a worktree task; otherwise `buildDrawer` with `configured = !portsOnboardingRelevant(task.path)` and the heuristic cached per task path (recomputed on `.dash` changes and on `refresh`).
- `on('taskCreated')`: `setupTask` and `files.watch(task.id, '.dash', …)`; the watch re-runs `setupTask`, feeds `config`/`configError` into `next`, and refreshes. `on('taskDeleted')`: stop its services, forget in-memory state. At activation, arm the watch for every existing non-archived worktree task.
- Effects: `createSetupTask` → `ctx.tasks.create({projectId, name:'port-setup', initialPrompt: buildPortsSetupPrompt(heuristic)})` (after `mkdir .dash` and `setupTask` on the new worktree), store `waiting` on the new task (`setupTaskBorn`), `ctx.tasks.activate(newId)`, then `created` on the source task; a throw → `createFailed`. `restartSessions` → `ctx.tasks.restartSessions(taskId)`. `toastAllocated` → `ctx.notify.toast({kind:'success', title:'Ports allocated', body:'Restart sessions from the Ports drawer.'})`.
- `session.env(({path}) => getEnvForWorktree(path))`.
- Actions: `start`, `restart`, `dismiss` → `next`; `open-setup` → `ctx.tasks.activate(setupTaskId)`; `open:<label>` → `ctx.shell.openUrl`; `run/stop/logs:<label>`, `run-all`, `stop-all` → `ServiceRunner`; `refresh` → re-run `setupTask` and heuristic.
- A 60 s `ctx.setInterval` sends `tick` to tasks in `waiting`.

- [ ] Write failing tests with a fake `ctx`: an unconfigured task's drawer shows Start setup; `start` calls `tasks.create` with the setup prompt and activates the new task, whose drawer shows waiting; a valid `.dash/ports.json` in the setup task gives `allocated` and a toast; `restart` calls `restartSessions`; a configured task's drawer lists ports; `session.env` returns the allocated vars
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/ports` → passes; `pnpm run type-check` → clean

### Task 16: Migrate ports data

Lands in the same commit as Task 17, because it drops tables the old code still reads.

**Files:** modify `src/main/addonHost/addonStore.ts` (`importLegacyPortsData(db)`, called from `runMigrations` after `ensureAddonTables`) · test in `addonStore.test.ts`

**Behaviour:** if table `task_ports` exists, group its rows by task into
`addon_data('ports','task',taskId,'ports', JSON TaskPort[])` and drop it; drop
`feature_dismissals`; delete `drawer_tabs` rows with `kind='tui'`. Idempotent.

- [ ] Write failing test on an in-memory DB seeded with the old tables
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addonHost` → passes; on a copy of a real `app.db`, `sqlite3 copy.db ".tables"` after a dev-instance boot shows `task_ports` and `feature_dismissals` gone and `addon_data` has the ports rows

### Task 17: Switch to the ports add-on and delete the old wiring

**Files:** modify `src/main/addons/index.ts` (`[ports, rtk]`) · delete the originals copied in Task 12 (`src/main/services/{WorkspacePortsService,WorkspacePortsRuntime,PortAllocator,PortLivenessService,PortsHeuristic,PortsSetupPrompt,ServiceRunner,derivedEnv,PortsConfigWatcher}.ts` and their tests in `src/main/services/__tests__/`), the port types in `src/shared/types.ts`, `src/main/wizard/` (incl. `README.md`, tests), `src/main/tui/`, `src/shared/{wizards,tuiProtocol,portsTuiProtocol}.ts`, `src/main/ipc/{wizardIpc,portsIpc,servicesIpc}.ts`, `src/renderer/components/ports/`, `src/renderer/components/rightInspector/{PortsDrawer,PortsDrawerWrapper,PortsPanel}.tsx`, `rightInspector/usePortsState.ts`, `src/types/electron-api/ports.ts` · modify `main.ts:173-182,371-377`, `window.ts:3,40`, `ipc/index.ts:18,41`, `ipc/dbIpc.ts` (ports setup/watch and `getTuiHost` calls; `discardInitialPrompt` stays), `preload.ts` (`ports*`, `wizard*`, `ptyStartCommand` keys), `ptyIpc.ts:290`, `ptyManager.ts` (`PtyKind 'tui'` `:22`, TUI branch of `startCommandPty` `:835-880`, ports env loop `:566-574`), `claudeEnv.ts:4,166-170`, `DatabaseService.ts` (`isFeatureDismissed`, `markFeatureDismissed`, task-ports methods `:95-112, 480-561, 626+`), `db/schema.ts` (`taskPorts`, `featureDismissals`), `TerminalSessionManager.ts:18,383,1033`, `TerminalTabs.tsx` (Wizards group in the "+" menu `:291-337,542-575`, `tui` branches, `portsServiceReleaseTab`, `onPortsService*`; the "+" menu keeps only new-terminal), `App.tsx` (`TUI_FEATURE_IDS` effect `:382-410`, `onPortsRestartTask`, `onPortsTuiMigrated`, `PortsDrawerWrapper`, `portsDrawerCollapsed`), `ui/Toast.tsx` (`useWizardToasts`), `settingsKeys.ts` (`portsDrawerCollapsed`), `shared/drawerTabs.ts` (`TabKind` drops `'tui'`), `DrawerTabsService.ts` (tui id/active logic `:32,59`; sweep `:129-136` keeps `'service'`)

**Behaviour:** the only ports code is in `src/main/addons/ports/`; no core file
names ports, wizards or TUIs.

- [ ] Delete and edit
- [ ] Verify: `grep -rniE "wizard|tui_|getTuiHost|portsTui|WorkspacePorts|featureDismiss|task_ports" src --include='*.ts' --include='*.tsx' | grep -v "src/main/addons/ports\|NewProjectWizard\|newProject/\|addonStore"` → no matches; `pnpm run type-check`, `pnpm test`, `pnpm lint` → clean

### Task 18: Docs and release

**Files:** modify `CLAUDE.md` (architecture bullet: add-ons live in `src/main/addons/<id>/`, import only `@shared/addon-api`; host in `src/main/addonHost/`), `src/main/CLAUDE.md` if it mentions wizards, `docs/specs/2026-09-23-addons.md` (Status: implemented), `package.json` version

- [ ] Edit
- [ ] Verify: `grep -rn "wizard" CLAUDE.md src/main/CLAUDE.md` → no matches

## End-to-end verification

In a second dev instance with its own data dir, seeded with a copy of a real
`app.db` that has ports data and RTK enabled:

1. **Upgrade:** Settings → Add-ons shows Ports (on, side picker "Right") and RTK
   (on, from the old config, no side picker). An existing configured task's Ports
   drawer lists its ports unchanged.
2. **Setup:** on a project with `package.json` scripts using a port and no
   `.dash/ports.json`, the Ports drawer lists the detected services and Start
   setup. No toast appears on task switch. Start setup → a `port-setup` task is
   created and becomes active, its session starts with the setup prompt, its
   drawer shows "Waiting…". The source task's drawer says setup is running there.
   When the agent writes `.dash/ports.json`: a "Ports allocated" toast; the drawer
   shows "Allocated N ports" → Restart sessions restarts them; `echo $<PORT_VAR>`
   in a shell tab prints the allocated port.
3. **Services:** drawer Run → a service drawer tab appears and the row turns
   running; Logs focuses it; Stop stops it; closing the tab updates the row; Run
   all / Stop all work.
4. **Placement:** set Ports to Left → the drawer moves to the bottom of the left
   sidebar and collapsing the left sidebar hides it; the choice and collapse state
   survive a restart.
5. **RTK:** as in Task 11's manual check.
6. **Toggles:** disable Ports → its drawer disappears at once and the "Restart
   sessions to apply" toast appears; re-enable → it returns.
7. **Isolation:** make the drawer function throw (temporary local edit) → the
   drawer shows an error line; the rest of Dash works.
8. `pnpm run type-check && pnpm test && pnpm lint` → all clean.
