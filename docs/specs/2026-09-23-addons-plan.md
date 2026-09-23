# Add-ons implementation plan

**Goal:** Replace the wizard layer with the add-on system in
`docs/specs/2026-09-23-addons.md`, and rebuild RTK and port management as its
first two add-ons.
**Approach:** Three phases, each shippable on its own. Phase 1 builds the host,
API, storage and renderer surfaces with no add-ons registered (old ports/RTK code
untouched). Phase 2 moves RTK onto it and deletes the old RTK wiring. Phase 3
moves ports, then deletes the wizard/TUI machinery.
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

## 1. Deviations from the spec (apply to the spec in Task 0)

Found while planning; each keeps the build smaller or matches existing code:

1. Add-on drawer tabs keep `kind 'service'` (already generic in `TerminalTabs`)
   with `feature_id = addonId`; no new `'addon'` kind. Only `'tui'` is removed.
2. `ctx.files.watch(taskId, relDir, fn)` watches a **directory** (retrying until
   it exists), not a glob. Ports only watches `.dash/`.
3. `taskPanel` returns `{title, summary?, actions?: IconAction[], blocks}`: the
   ports drawer header has Run all / Stop all / Refresh and an "n/m up" summary.
4. `ctx` gains `tasks.get(taskId)` / `tasks.list()` (ports' collision check must
   skip archived tasks) and `terminals.focus(key, {reset?})` (Logs on a running
   service).
5. Hook contributions are typed `{event: 'PreToolUse', matcher, command}` only;
   more events when an add-on needs one.
6. `ctx.session.env` receives `{path, taskId | null}` (core builds env from a
   worktree path, not always a task) and must be synchronous.
7. Toggle block dropped (RTK's own `enabled` flag goes away), so actions carry no value.
8. `PATH` is a reserved env key (`claudeEnv.ts:32`), so env contributions can't
   set it. RTK's bin dir comes through a separate
   `ctx.session.path(() => string[])`, whose directories core prepends to `PATH`.

**Ordering rule.** An add-on replaces old code in one step: its files are
_copied_ in while the old code keeps running, it is built and tested against a
fake `ctx`, and it is added to `ADDONS` in the same task that deletes the old
wiring (Task 11 for RTK, Task 17 for ports). This keeps the lint boundary green
throughout and never runs old and new side by side.

## 2. File map

**New — API (shared, importable by add-ons and renderer)**

- `src/shared/addon-api/blocks.ts`: block types, zod schemas, builder functions.
- `src/shared/addon-api/index.ts`: `defineAddon`, `AddonContext`, `AddonSurfaces`,
  `TaskInfo`, `HookContribution`, re-exports blocks.

**New — host (main)**

- `src/main/addonHost/AddonHost.ts`: lifecycle, enable state, disposal, error
  isolation, surface evaluation, env/hook aggregation, event fan-out. Pure: takes `HostDeps`.
- `src/main/addonHost/hostDeps.ts`: `HostDeps` interface + production
  implementation over core services.
- `src/main/addonHost/addonStore.ts`: `addons` / `addon_data` table access.
- `src/main/addonHost/fileWatch.ts`: retrying directory watcher (generalised from `PortsConfigWatcher.ensureWatching`).
- `src/main/addonHost/registry.ts`: imports `ADDONS`, creates the singleton host.
- `src/main/ipc/addonsIpc.ts`: IPC handlers.
- `src/main/addons/index.ts`: `export const ADDONS: Addon[] = [...]`.

**New — renderer**

- `src/types/electron-api/addons.ts`: `AddonsApi` type.
- `src/renderer/stores/addonsStore.ts`: fetched surfaces cache.
- `src/renderer/components/addons/AddonBlocks.tsx`: block → `ui/` primitive renderer.
- `src/renderer/components/addons/AddonSettingsSection.tsx`: Settings → Add-ons content.
- `src/renderer/components/addons/AddonTaskCards.tsx`: task cards (replaces `useWizardToasts`).
- `src/renderer/components/addons/AddonPanelDrawer.tsx`: right-inspector drawer (generalised `PortsDrawerWrapper` + `PortsDrawer`).
- `src/renderer/components/addons/useAddonMenuItems.ts`: task-menu + drawer "+" items.

**Phase 2 (RTK), copied in Task 9, originals deleted in Task 11** → `src/main/addons/rtk/`: `RtkService.ts` split into
`binary.ts` (resolve, symlink), `download.ts`, `hookTest.ts`, `index.ts` (the add-on).
Tests `rtk-unit.test.ts`, `rtk-integration.test.ts` are copied to `src/main/addons/rtk/__tests__/`.

**Phase 3 (ports), copied in Task 12, originals deleted in Task 17** → `src/main/addons/ports/`: `WorkspacePortsService.ts`,
`WorkspacePortsRuntime.ts`, `PortAllocator.ts`, `PortLivenessService.ts`,
`PortsHeuristic.ts`, `PortsSetupPrompt.ts`, `ServiceRunner.ts`, `derivedEnv.ts`
(only ports uses it once core stops calling it), plus new `steps.ts`, `surfaces.ts`,
`index.ts`. Their tests are copied to `src/main/addons/ports/__tests__/`.

**Deleted (Phase 2/3)**: see Tasks 11 and 17.

## Phase 1 — the host

### Task 0: Update the spec

**Files:** modify `docs/specs/2026-09-23-addons.md`

**Behaviour:** the spec reflects the eight deviations in §1.

- [ ] Edit §3.2 (`ctx` table, incl. `session.path`, `tasks.get/list`, `terminals.focus`), §3.3 (`taskPanel` signature), §3.4 (no `toggle`), §4 (drawer tabs keep `kind 'service'`)
- [ ] Verify: `grep -n "toggle\|kind 'addon'" docs/specs/2026-09-23-addons.md` → no matches

### Task 1: Add-on API and blocks

**Files:** create `src/shared/addon-api/blocks.ts`, `src/shared/addon-api/index.ts` · test `src/shared/addon-api/__tests__/blocks.test.ts`

**Behaviour:** add-ons and the host share one typed contract; `BlockSchema`
accepts every block in spec §3.4 and rejects unknown types, unknown icons and
missing required fields.

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
export type Card = {
  title: string;
  body?: Block[];
  actions?: Extract<Block, { type: 'button' }>[];
  dismissable?: boolean;
};
export type Panel = { title: string; summary?: string; actions?: IconAction[]; blocks: Block[] };
export type MenuAction = { id: string; label: string; done?: boolean };
// builders: text(), row(), list(), button(), progress(), code(), card(), iconAction()

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
export type SurfaceRef = {
  surface: 'settings' | 'taskCard' | 'taskPanel' | 'taskMenu';
  taskId?: string;
};
export interface AddonSurfaces {
  settings?(): Block[];
  taskCard?(task: TaskInfo): Card | null;
  taskPanel?(task: TaskInfo): Panel | null;
  taskMenu?(task: TaskInfo): MenuAction[];
  onAction?(ref: SurfaceRef, actionId: string): void | Promise<void>;
  onCardDismissed?(task: TaskInfo): void;
  dispose?(): void | Promise<void>;
}
export interface TerminalHandle {
  key: string;
  tabId: string;
}
export interface AddonContext {
  session: {
    env(fn: (wt: { path: string; taskId: string | null }) => Record<string, string>): void;
    hooks(fn: () => HookContribution[]): void;
    path(fn: () => string[]): void; // dirs prepended to PATH
  };
  on(event: 'taskCreated' | 'taskDeleted' | 'taskActivated', fn: (task: TaskInfo) => void): void;
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
  activate(ctx: AddonContext): AddonSurfaces | Promise<AddonSurfaces>;
}
export function defineAddon(a: Addon): Addon {
  return a;
}
```

- [ ] Write failing tests: valid samples of each block parse; `{type:'html'}`, `icon:'bomb'`, `row` without `label` fail
- [ ] Implement
- [ ] Verify: `pnpm test src/shared/addon-api` → passes; `pnpm run type-check` → clean

### Task 2: Storage tables and `addonStore`

**Files:** modify `src/main/db/migrate.ts` (append before `rawDb.pragma('foreign_keys = ON')`, ~line 349), `src/main/db/schema.ts` (append) · create `src/main/addonHost/addonStore.ts` · test `src/main/addonHost/__tests__/addonStore.test.ts`

**Behaviour:** two tables exist; the store reads/writes enable state and
scoped JSON values; deleting a task or project removes its rows.

```sql
CREATE TABLE IF NOT EXISTS addons (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS addon_data (
  addon_id TEXT NOT NULL, scope TEXT NOT NULL,      -- 'global' | 'project' | 'task'
  scope_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (addon_id, scope, scope_id, key));
```

`addonStore` exports `createAddonStore(db: Database)` with `getEnabled(id)`
(`undefined` when no row), `setEnabled`, `get/set/delete/list` matching
`AddonContext.storage`, and `deleteScope(scope, scopeId)` (called on task and
project deletion). Put the table DDL in an exported `ensureAddonTables(db)` that
`migrate.ts` calls, so tests can run it against `new Database(':memory:')`.

- [ ] Write failing tests: set/get round-trip per scope; `list('task', 'ports')` returns all tasks' values; `deleteScope('task', id)` removes only that task's rows; `getEnabled` undefined → default applies
- [ ] Implement; call `ensureAddonTables(rawDb)` from `runMigrations`
- [ ] Verify: `pnpm test src/main/addonHost` → passes

### Task 3: `AddonHost`

**Files:** create `src/main/addonHost/AddonHost.ts` · test `src/main/addonHost/__tests__/AddonHost.test.ts`

**Behaviour:** given `Addon[]`, a store and `HostDeps` (all fakeable), the host:

- `start()` activates every enabled add-on (enabled = store row, else `defaultEnabled`), in parallel, each capped at 10 s; a throw or timeout sets status `failed` with the message; resolves when all have settled.
- Wraps every `ctx` registration (`on`, `session.env`, `session.hooks`, `files.watch`, `terminals.run`, `setInterval`) so `disable(id)` undoes all of them, calls `dispose()`, drops surfaces, then calls `deps.refreshHooks()` and emits `changed(id)`.
- `setEnabled(id, bool)` persists and activates/disables live. Enabling or disabling an add-on that has env contributions calls `deps.notifyEnvChanged()` (renderer shows "Restart sessions to apply").
- `envFor({path, taskId})` merges every active add-on's env (later add-ons in `ADDONS` order win; keys in core's `RESERVED_ENV_KEYS` are dropped); a throwing contributor is logged and skipped.
- `hookEntries()` concatenates contributions; throwing contributor skipped.
- `pathDirs()` concatenates `session.path` contributions, de-duplicated; throwing contributor skipped.
- `emit(event, task)` calls listeners; each listener's throw is caught and logged.
- `surfacesFor({taskId?})` returns `{addonId, settings?, taskCard?, taskPanel?, taskMenu?, error?}[]` for active add-ons; each surface function runs in try/catch and its output is validated with the zod schema; failure → that surface replaced by `{error: message}`.
- `action(addonId, ref, actionId)` calls `onAction` (awaited, errors → toast via `deps.toast` + log).
- `ctx.refresh()` → `deps.emitChanged(addonId)` (debounced 50 ms per add-on).
- `stop()` disables all (quit).

- [ ] Write failing tests for each bullet with a fake add-on and fake deps
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addonHost/__tests__/AddonHost.test.ts` → passes

### Task 4: Production `HostDeps`

**Files:** create `src/main/addonHost/hostDeps.ts`, `src/main/addonHost/fileWatch.ts` · test `src/main/addonHost/__tests__/fileWatch.test.ts`

**Behaviour:** each `ctx` capability is backed by real core services:

| ctx                                | Backed by                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.get/list`                   | `DatabaseService.getTask` / all projects' tasks → `TaskInfo` (`archived = archivedAt != null`)                                                                                                                                                                                                                                                                                                    |
| `tasks.create`                     | Same steps as `handleMigrate` in `src/main/wizard/ports/index.ts:103-150`: `worktreeService.createWorktree(project.path, name, {projectId, pushRemote:false})`, `DatabaseService.saveTask({... useWorktree:true, branchCreatedByDash:true})`, `setInitialPrompt(task.id, prompt)` when given, then host `emit('taskCreated')`, then send `addons:taskCreated {taskId, projectId}` to the renderer |
| `tasks.activate`                   | send `addons:activateTask {taskId, projectId}`                                                                                                                                                                                                                                                                                                                                                    |
| `tasks.restartSessions`            | send `addons:restartTask taskId` (renderer calls `sessionRegistry.restartAllForTask`, as `App.tsx:416-421` does today)                                                                                                                                                                                                                                                                            |
| `tasks.refreshHooks`               | `refreshActivePtyHooks()` (`ptyManager.ts:150-175`); failures → toast                                                                                                                                                                                                                                                                                                                             |
| `terminals.*`                      | `ServiceRunner`'s spawn path in `src/main/ipc/servicesIpc.ts:73-106`: `DrawerTabsService.add(taskId, {kind:'service', featureId: addonId, label, id})` with id `svc:<addonId>:<taskId>:<slug(key)>`, clear snapshot, `startCommandPty({kind:'service', …})`, `killPty`, `hasPty`; `focus` sends `addons:focusTab {taskId, tabId, reset}`                                                          |
| `files.watch`                      | `fileWatch.ts`: `fs.watch(path.join(taskPath, relDir))`, debounced 150 ms; if the dir does not exist, retry every 2 s until it does; returns a disposer                                                                                                                                                                                                                                           |
| `notify.toast`                     | `webContents.send('app:toast', …)` (existing channel)                                                                                                                                                                                                                                                                                                                                             |
| `shell.openUrl/copy`               | `shell.openExternal` (http/https only) / `clipboard.writeText`                                                                                                                                                                                                                                                                                                                                    |
| `paths.data`                       | `<userData>/addons/<id>/`, created on first access                                                                                                                                                                                                                                                                                                                                                |
| `emitChanged` / `notifyEnvChanged` | `webContents.send('addons:changed', {addonId})` / `('addons:envChanged', {addonId})`                                                                                                                                                                                                                                                                                                              |

The sender comes from `setSender(webContents)` like other services (called in `main.ts` next to the existing `setSender` calls, lines ~150-170 and the `activate` handler ~270-290).

- [ ] Write failing test for `fileWatch`: watching a missing dir, then creating it and a file in it, fires once (use a temp dir, fake timers where needed)
- [ ] Implement `fileWatch.ts` and `hostDeps.ts`
- [ ] Verify: `pnpm test src/main/addonHost` → passes; `pnpm run type-check` → clean

### Task 5: Registry and core call sites

**Files:** create `src/main/addons/index.ts` (`export const ADDONS: Addon[] = []`), `src/main/addonHost/registry.ts` · modify `src/main/services/claudeEnv.ts:160-170`, `src/main/services/ptyManager.ts:566-574`, `src/main/services/ptyHookSettings.ts:71-80`, `src/main/ipc/dbIpc.ts:63-110`, `src/main/main.ts` (boot ~165-186, quit ~304-392), project deletion handler in `dbIpc.ts`

**Behaviour:** core calls the host at five points, next to (not yet replacing) the
existing ports/RTK code:

- `buildClaudeEnv`: after the ports merge, `for (k,v of addonHost.envFor({path: cwd, taskId}))` skipping `RESERVED_ENV_KEYS`; and prepend `addonHost.pathDirs()` to `PATH` with the existing `prependUnique` (next to the RTK prepend at `:86-91`, which Task 11 removes).
- Shell PTY env in `ptyManager`: same env merge and `PATH` prepend after the ports loop.
- `buildPreToolUseHooks`: append `addonHost.hookEntries()` mapped to `{matcher, hooks:[tagDash({type:'command', command})]}`.
- `db:saveTask` (new worktree task) → `addonHost.emit('taskCreated', info)`; `db:deleteTask` → `emit('taskDeleted', info)` **before** `DatabaseService.deleteTask`, then `addonStore.deleteScope('task', id)`; project delete → `deleteScope('project', id)`.
- `main.ts`: `await addonHost.start()` right after the RTK warm-up block (before `registerAllIpc`'s first PTY can spawn); `addonHost.stop()` in the quit sequence before `killAll`.

- [ ] Implement
- [ ] Verify: `pnpm run type-check` and `pnpm test` → clean/passing; start a dev instance, open a task → no behaviour change, no console errors

### Task 6: IPC, preload, types

**Files:** create `src/main/ipc/addonsIpc.ts`, `src/types/electron-api/addons.ts` · modify `src/main/ipc/index.ts`, `src/main/preload.ts`, `src/types/electron-api.d.ts`

**Behaviour:** zod-validated channels:

| Channel                                                                                                                     | Kind          | Payload → result                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `addons:list`                                                                                                               | invoke        | → `{id, name, description, enabled, status: 'active'\|'failed'\|'disabled', error?}[]` |
| `addons:setEnabled`                                                                                                         | invoke        | `{id, enabled}`                                                                        |
| `addons:surfaces`                                                                                                           | invoke        | `{taskId?}` → host `surfacesFor` result                                                |
| `addons:action`                                                                                                             | invoke        | `{addonId, ref, actionId}`                                                             |
| `addons:cardDismissed`                                                                                                      | invoke        | `{addonId, taskId}`                                                                    |
| `addons:taskActivated`                                                                                                      | invoke        | `taskId` → host `emit('taskActivated')`                                                |
| `addons:terminalClosed`                                                                                                     | invoke        | `{taskId, tabId}` → the owning `terminals.run` handle's `onClosed`                     |
| `addons:changed`, `addons:envChanged`, `addons:taskCreated`, `addons:activateTask`, `addons:restartTask`, `addons:focusTab` | main→renderer | as in Task 4                                                                           |

- [ ] Write failing test in `src/main/ipc/__tests__/validate.test.ts` style for the zod schemas (bad `ref.surface`, missing `addonId` rejected)
- [ ] Implement; register in `ipc/index.ts`; preload keys `addonsList`, `addonsSetEnabled`, `addonsSurfaces`, `addonsAction`, `addonsCardDismissed`, `addonsTaskActivated`, `addonsTerminalClosed`, `onAddonsChanged`, `onAddonsEnvChanged`, `onAddonsTaskCreated`, `onAddonsActivateTask`, `onAddonsRestartTask`, `onAddonsFocusTab`
- [ ] Verify: `pnpm run type-check`, `pnpm test` → clean/passing

### Task 7: Renderer surfaces

**Files:** create the five files under `src/renderer/components/addons/` and `src/renderer/stores/addonsStore.ts` · modify `src/renderer/components/settings/SettingsModal.tsx` (add-ons tab, `:1495-1530`), `src/renderer/components/ui/Toast.tsx:4,11`, `src/renderer/App.tsx` (right-inspector wrapper `:1303-1351`, active-task effect `:382-410`, listeners `:412-437`), `src/renderer/components/task/TaskMenuItems.tsx`, `src/renderer/components/terminal/TerminalTabs.tsx` ("+" menu `:542-575`, tab close `:340-349`, focus listener `:260-275`), `src/renderer/stores/settingsKeys.ts` (add `addonPanelCollapsed: Record<string, boolean>`)

**Behaviour:**

- `addonsStore`: `list`, `surfaces` for the active task and for settings; `load()`; refetches on `onAddonsChanged` and on active-task change; `action()`, `setEnabled()`.
- `AddonBlocks` renders each block with existing primitives: `row`/`list` like `PortsPanel.tsx` rows (status dot classes from `PortsPanel.tsx:17-21`, `Tooltip`, `IconButton`); `button` → `Button`; `progress` → `ProgressBar`; `code` → `<pre>` in a `surface-1` box; `text` with `text-muted-fade-*` tones. An `{error}` surface renders one `text` line with `tone:'error'`.
- Settings → Add-ons: one `AddOnAccordion` per add-on (keep the component, move it out of `SettingsModal.tsx` into `AddonSettingsSection.tsx`): header shows name + status, a `Switch` for enabled, then `AddonBlocks(settings)`; a `failed` add-on shows its error. The existing RTK accordion stays until Task 11.
- Task cards: `AddonTaskCards` mounted in `Toast.tsx` beside `useWizardToasts`: one sonner toast per (addon, active task) card, id `addon:<addonId>:<taskId>`, updated in place when the card changes, dismissed when it becomes `null`; closing a `dismissable` card calls `addonsCardDismissed`.
- Right inspector: `AddonPanelDrawer` wraps `RightInspector` inside the existing `PortsDrawerWrapper` (nesting is fine until Task 17), one collapsible section per non-null panel, header = title, summary, icon actions; collapse state in `addonPanelCollapsed[addonId]`.
- Menus: `useAddonMenuItems(task)` feeds a group into `TaskMenuItems` and the drawer "+" dropdown (label, check mark when `done`).
- App: on active-task change call `addonsTaskActivated(taskId)`; handle `onAddonsTaskCreated` (like `App.tsx:430-437`: `loadTasksForProject` then set active project + task), `onAddonsActivateTask`, `onAddonsRestartTask` (`sessionRegistry.restartAllForTask`), `onAddonsEnvChanged` (toast "Restart sessions to apply" with an action restarting the active task).
- TerminalTabs: on closing a `service` tab whose `featureId` is not `'ports'`, call `addonsTerminalClosed`; `onAddonsFocusTab` behaves like `onPortsServiceFocusTab` (`:260-275`).

- [ ] Implement
- [ ] Verify: `pnpm run type-check`, `pnpm lint` → clean. Manual: add a throwaway add-on locally (not committed) returning a settings button, a task card and a panel with two rows; in a dev instance confirm each renders, actions round-trip (log in main), toggling it off removes all three without restart, a surface that throws shows an error line only in that surface

### Task 8: Lint boundary

**Files:** modify `eslint.config.mjs`

**Behaviour:** three `no-restricted-imports` blocks per spec §2:

- `files: ['src/main/addons/*/**']`: forbid patterns `@/*`, `@shared/*` except `@shared/addon-api*`, `../../*` (leaving the add-on folder), `electron` (add-ons reach Electron only through `ctx`).
- `files: ['src/**']` ignoring `src/main/addons/**` and `src/main/addonHost/registry.ts`: forbid `**/addons/*`.
- `files: ['src/shared/addon-api/**']`: forbid `@/*`, `**/main/**`, `**/renderer/**`.

- [ ] Implement
- [ ] Verify: add a temporary `import { DatabaseService } from '@/services/DatabaseService'` to a file in `src/main/addons/` → `pnpm lint` fails; remove it → passes

**Phase 1 done when:** type-check, tests, lint pass; the dev instance behaves as
before; commit and bump version.

## Phase 2 — RTK as an add-on

### Task 9: Copy RTK into `src/main/addons/rtk/`

**Files:** copy `src/main/services/RtkService.ts` → split into `src/main/addons/rtk/{binary.ts,download.ts,hookTest.ts}`; copy the RTK types (`src/shared/types.ts:726-802`) into `src/main/addons/rtk/types.ts` · copy tests to `src/main/addons/rtk/__tests__/`. The originals stay until Task 11.

**Behaviour:** RTK logic has no `electron` import and no module state tied to
`app`: functions take `dataDir` (= `ctx.paths.data`) instead of
`app.getPath('userData')`. The managed binary lives at `<dataDir>/bin/rtk`. The
`~/.local/bin/rtk` symlink logic (`RtkService.ts:145-158`) is kept. Download
reports progress through a callback instead of `rtk:downloadProgress`.

- [ ] Move tests first, adjust imports; they fail
- [ ] Split and adapt the code until they pass
- [ ] Verify: `pnpm test src/main/addons/rtk` → passes

### Task 10: The RTK add-on

**Files:** create `src/main/addons/rtk/index.ts` · test `src/main/addons/rtk/__tests__/rtkAddon.test.ts` (not yet added to `ADDONS`)

**Behaviour:**

- `defaultEnabled: false`. `activate`: if `<userData>/bin/rtk` (old location) exists and `<dataDir>/bin/rtk` doesn't, move it and repoint the `~/.local/bin/rtk` symlink; then resolve the binary (managed first, then `$PATH`, probed with `--version`, as `RtkService.ts:164-203`).
- `session.path`: `[binDir]` when the binary is managed, else `[]` (replaces the prepend in `claudeEnv.ts:86-91`).
- `session.hooks`: `[{event:'PreToolUse', matcher:'Bash', command:"'<bin>' hook claude"}]` when a binary is resolved, else `[]`.
- `settings()`: status `text` (version + source, or "Not installed"), `button('download', 'Install RTK' | 'Update')` with `busy` + `progress` during download, `button('test', 'Test RTK')`, and after a test a `code` block with the tested command and the before/after output (or the error), plus a link-style `text` to github.com/rtk-ai/rtk.
- `onAction('download')`: download, re-resolve, `ctx.tasks.refreshHooks()`, `ctx.refresh()`; errors → `ctx.notify.toast`. `onAction('test')`: run `hookTest`, keep the result in memory, refresh.
- Tests (fake `ctx`): hooks empty without binary; with binary: hook command quoted; settings blocks per state; download failure keeps previous binary and toasts.

- [ ] Write failing tests
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/rtk` → passes

### Task 11: Remove the old RTK wiring and migrate its setting

**Files:** delete `src/main/ipc/rtkIpc.ts`, `src/types/electron-api/rtk.ts`, old `src/main/services/RtkService.ts`, `src/main/services/__tests__/rtk-{unit,integration}.test.ts`, RTK types in `src/shared/types.ts:726-802` · modify `src/main/addons/index.ts` (`[rtk]`), `src/main/ipc/index.ts:9,32`, `src/main/preload.ts:426-440`, `src/types/electron-api.d.ts:12,45`, `src/main/main.ts:165-170,279-280`, `src/main/services/claudeEnv.ts:2,86-91`, `src/main/services/ptyHookSettings.ts:5,75-78`, `src/main/services/ptyManager.ts:147` (comment), `src/renderer/stores/runtimeStore.ts` (RTK state/actions/init), `src/renderer/components/settings/SettingsModal.tsx` (RTK imports `:53-55`, selectors `:759-762`, accordion `:1497-1529`, `RtkStatusCardBody`, `labelForProgress`, `RtkSection`, `RtkTestResultCard`), `src/main/addonHost/addonStore.ts` (one-time import)

**Behaviour:** RTK exists only as an add-on. On first boot after upgrade, if
`<userData>/rtk-config.json` has `enabled: true` and no `addons` row for `rtk`
exists, insert `rtk → enabled`; then delete the file. Core files contain no `rtk`.

- [ ] Write failing test for the one-time import in `addonStore.test.ts`
- [ ] Implement deletions and the import
- [ ] Verify: `grep -rni "rtk" src/main/services src/main/ipc src/main/main.ts src/renderer/stores src/renderer/components/settings/SettingsModal.tsx` → no matches; `pnpm run type-check`, `pnpm test`, `pnpm lint` → clean
- [ ] Manual (dev instance): Settings → Add-ons → RTK off by default; enable, Install, Test shows a rewritten `git status`; in a task session `git status` output is compressed; the worktree's `.claude/settings.local.json` has the Bash `PreToolUse` entry; disable RTK → entry gone without restart

**Phase 2 done when:** checks pass, manual RTK check passes; commit, bump version.

## Phase 3 — ports as an add-on

### Task 12: Copy the ports services

**Files:** copy (originals stay until Task 17) `WorkspacePortsService.ts`, `WorkspacePortsRuntime.ts`, `PortAllocator.ts`, `PortLivenessService.ts`, `PortsHeuristic.ts`, `PortsSetupPrompt.ts`, `ServiceRunner.ts`, `derivedEnv.ts`, `src/main/wizard/ports/relevance.ts` → `src/main/addons/ports/`; copy their tests (`PortAllocator`, `PortsHeuristic`, `ServiceRunner`, `WorkspacePortsService`, `derivedEnv`, `exportPipeline`, `PortsConfigWatcher`) → `src/main/addons/ports/__tests__/`; copy the `TaskPort`/`PortLiveness` types from `src/shared/types.ts` into `src/main/addons/ports/types.ts`

**Behaviour:** the moved code compiles inside the lint boundary:

- `WorkspacePortsRuntime` takes a `PortsStore` (`get(taskId)`, `set(taskId, ports)`, `takenHostPorts(excludeTaskId)`) instead of `DatabaseService`. The production `PortsStore` uses `ctx.storage` key `'ports'` in task scope; `takenHostPorts` = `ctx.storage.list('task','ports')` filtered by `ctx.tasks.get(id)?.archived === false` (replaces `DatabaseService.getTakenHostPorts`, `DatabaseService.ts:550-561`).
- `ServiceRunner`'s `RunnerDeps` drawer-tab/PTY members are implemented over `ctx.terminals`; `exec`, `lsofPids`, `killPid` stay in the add-on (Node `child_process`); `notifyChanged` → `ctx.refresh()`; `focusTab` → `ctx.terminals.focus`.
- `PortLivenessService` runs on `ctx.setInterval` and calls `ctx.refresh()` on change instead of sending `ports:liveness`.
- `PortsConfigWatcher` is replaced by `ctx.files.watch(taskId, '.dash', …)`, which re-runs `setupTask` and records success or errors in memory.
- Nothing in core imports the copies; the old files keep serving the app until Task 17.

- [ ] Copy tests, adjust imports (fail), adapt code (pass)
- [ ] Verify: `pnpm test src/main/addons/ports` → passes; `pnpm lint` → no boundary violations under `src/main/addons/ports`

### Task 13: The setup flow as steps

**Files:** create `src/main/addons/ports/steps.ts` · test `src/main/addons/ports/__tests__/steps.test.ts`

**Behaviour:** a pure reducer replaces `PortsOnboardingWizard` and `PortsSetupWizard`:

```ts
type Step =
  | { kind: 'offer'; signals: string[]; guesses: string[] } // source task
  | { kind: 'migrating' }
  | { kind: 'error'; message: string }
  | { kind: 'waiting-config'; since: number; errors?: string[] } // setup task
  | { kind: 'done'; count: number }
  | { kind: 'restarting' };
type Event =
  | {
      type: 'activated';
      relevant: boolean;
      dismissed: boolean;
      snoozed: boolean;
      heuristic: { signals; guesses };
    }
  | { type: 'choose'; value: 'setup' | 'not-now' | 'never' | 'restart' | 'later' }
  | { type: 'migrated' }
  | { type: 'migrateFailed'; message: string }
  | { type: 'setupTaskCreated' }
  | { type: 'config'; count: number }
  | { type: 'configError'; errors: string[] }
  | { type: 'tick'; now: number };
export function next(step: Step | null, ev: Event): { step: Step | null; effects: Effect[] };
// Effect: 'migrate' | 'markDismissed' | 'snooze' | 'restart' | 'dismissCard'
```

Rules (from the current wizards): `activated` with relevant, not dismissed, not
snoozed → `offer`; `offer` + `setup` → `migrating` + `migrate`; `not-now` →
`null` + `snooze` (session only, per project, as `WizardHost.ts:56`); `never` →
`null` + `markDismissed`; `migrated` → `null` in the source task;
`setupTaskCreated` → `waiting-config`; `configError` in waiting → same step with
errors; `config` in waiting → `done`; `tick` more than 30 min after `since` →
`error "Agent didn't write ports.json within 30 minutes."`; `done` + `restart` →
`restarting` + `restart`; `done` + `later` → `null`.

- [ ] Write failing tests for each rule
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/ports/__tests__/steps.test.ts` → passes

### Task 14: Ports surfaces

**Files:** create `src/main/addons/ports/surfaces.ts` · test `src/main/addons/ports/__tests__/surfaces.test.ts`

**Behaviour:** pure functions from state to blocks:

- `taskCard(step)`: `offer` → card "Set up port management?" with body listing signals and guesses, buttons `setup` (primary) "Set it up", `not-now` "Not now", `never` "Not for this project"; `migrating` → indeterminate `progress` "Creating port-setup task…"; `waiting-config` → `progress` "Waiting for the agent to write .dash/ports.json" plus error `text` lines when `errors`; `done` → "Allocated N ports" with `restart` "Restart sessions" and `later`; `restarting` → progress; `error` → error text, dismissable.
- `taskPanel(ports, liveness, owned)`: `null` when no ports; title "Ports", summary `"<up>/<total> up"`, header actions `run-all`, `stop-all`, `refresh` (only when applicable, as `usePortsState.ts` `anyRunnable`/`allRunnableUp`/`anyRunning`), a `list` of rows: label, meta `:<hostPort>`, status (running when owned, per `PortsPanel.tsx:59-83`), tooltip `"<label> · <source label> · $ENV · <status>"`, `onClick` `open:<label>`, actions `run:<label>`/`stop:<label>` and `logs:<label>`.
- `taskMenu(relevant)`: `[{id:'setup', label:'Service management', done: !relevant}]`.

- [ ] Write failing tests with fixed inputs (compare against expected block trees)
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/ports/__tests__/surfaces.test.ts` → passes

### Task 15: The ports add-on

**Files:** create `src/main/addons/ports/index.ts` · test `src/main/addons/ports/__tests__/portsAddon.test.ts` (not yet added to `ADDONS`)

**Behaviour:** wires Tasks 12–14 to `ctx`:

- `defaultEnabled: true`. Steps persisted in task-scoped storage key `'step'`; dismissal in project scope `'dismissed'`; snooze in memory.
- `on('taskCreated')` for worktree tasks: `setupTask`, `files.watch('.dash')`. `on('taskDeleted')`: stop services, forget in-memory state. `on('taskActivated')`: run `next(step, activated…)` with `relevant = portsOnboardingRelevant(path) && detectPortsNeed(path).needsPorts`.
- Effects: `migrate` → `ctx.tasks.create({projectId, name:'port-setup', initialPrompt: buildPortsSetupPrompt(...)})` after `mkdir .dash` + `setupTask` on it, set the new task's step via `setupTaskCreated`, `ctx.tasks.activate(newId)`, then `migrated` on the source task (failure → `migrateFailed`); `restart` → after 500 ms `ctx.tasks.restartSessions`; `markDismissed` → storage.
- `session.env(({path}) => getEnvForWorktree(path))`.
- Actions: card buttons feed `next`; `open:<label>` → `ctx.shell.openUrl`; `run/stop/logs:<label>`, `run-all`, `stop-all` → `ServiceRunner`; `refresh` → re-run `setupTask`; menu `setup` → forced offer (ignores dismissal and snooze, as `TerminalTabs.tsx:317-330` `force`).
- A 60 s `ctx.setInterval` sends `tick` to tasks in `waiting-config`.

- [ ] Write failing tests with a fake `ctx`: `taskActivated` on a relevant task yields an offer card; `setup` calls `tasks.create` with the setup prompt and activates the new task; a `.dash` change with a valid config moves the setup task to `done`; `never` stores `dismissed` and no card appears on the next activation; `session.env` returns the allocated vars
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addons/ports` → passes; `pnpm run type-check` → clean

### Task 16: Migrate ports data

Lands in the same commit as Task 17: it drops tables the old code still reads.

**Files:** modify `src/main/addonHost/addonStore.ts` (`importLegacyPortsData(db)`, called from `runMigrations` after `ensureAddonTables`) · test in `addonStore.test.ts`

**Behaviour:** if table `task_ports` exists: group rows by task into
`addon_data('ports','task',taskId,'ports', JSON TaskPort[])`; copy
`feature_dismissals` rows with `feature_id='ports'` into
`addon_data('ports','project',projectId,'dismissed', true)`; then drop both
tables. `drawer_tabs` rows with `kind='tui'` are deleted (rows with
`kind='service'` are swept at every boot already). Idempotent.

- [ ] Write failing test on an in-memory DB seeded with both old tables
- [ ] Implement
- [ ] Verify: `pnpm test src/main/addonHost` → passes; also run against a copy of a real `app.db` (`sqlite3 copy.db ".tables"` before/after shows `task_ports`/`feature_dismissals` gone and `addon_data` populated)

### Task 17: Delete the wizard, TUI and old ports wiring

**Files:** modify `src/main/addons/index.ts` (`[ports, rtk]`) · delete the originals copied in Task 12 (`src/main/services/{WorkspacePortsService,WorkspacePortsRuntime,PortAllocator,PortLivenessService,PortsHeuristic,PortsSetupPrompt,ServiceRunner,derivedEnv}.ts` and their tests in `src/main/services/__tests__/`), the port types in `src/shared/types.ts`, `src/main/wizard/` (incl. `README.md`, tests), `src/main/tui/`, `src/shared/wizards.ts`, `src/shared/tuiProtocol.ts`, `src/shared/portsTuiProtocol.ts`, `src/main/ipc/{wizardIpc,portsIpc,servicesIpc}.ts`, `src/main/services/PortsConfigWatcher.ts`, `src/renderer/components/ports/`, `src/renderer/components/rightInspector/{PortsDrawer,PortsDrawerWrapper,PortsPanel,usePortsState}.tsx?`, `src/types/electron-api/ports.ts` · modify: `main.ts:173-182,371-377`, `window.ts:3,40`, `ipc/index.ts:18,41`, `ipc/dbIpc.ts` (ports setup/watch, `discardInitialPrompt` stays, `getTuiHost` call), `preload.ts` (`ports*`, `wizard*`, `ptyStartCommand` keys), `ptyIpc.ts:290` (`ptyStartCommand`), `ptyManager.ts` (`PtyKind 'tui'` `:22`, TUI branch of `startCommandPty` `:835-880`, ports env loop `:566-574`), `claudeEnv.ts:4,166-170`, `DatabaseService.ts` (`isFeatureDismissed`, `markFeatureDismissed`, task-ports methods `:95-112, 480-561, 626+`), `db/schema.ts` (`taskPorts`, `featureDismissals`), `TerminalSessionManager.ts:18,383,1033` (TUI sizing), `TerminalTabs.tsx` (`WIZARDS` menu, `tui` kind branches, `portsServiceReleaseTab`, `onPortsService*`), `App.tsx` (`TUI_FEATURE_IDS` effect, `onPortsRestartTask`, `onPortsTuiMigrated`, `PortsDrawerWrapper`, `portsDrawerCollapsed`), `Toast.tsx` (`useWizardToasts`), `settingsKeys.ts` (`portsDrawerCollapsed`), `shared/drawerTabs.ts` (`TabKind` drops `'tui'`), `DrawerTabsService.ts` (tui id/active logic `:32,59`, sweep `:129-136` keeps `'service'`)

**Behaviour:** the only ports code is in `src/main/addons/ports/`; no core file
names ports, wizards or TUIs.

- [ ] Delete and edit
- [ ] Verify: `grep -rniE "wizard|tui_|getTuiHost|portsTui|WorkspacePorts|featureDismiss|task_ports" src --include='*.ts' --include='*.tsx' | grep -v "src/main/addons/ports\|NewProjectWizard\|newProject/"` → no matches; `pnpm run type-check`, `pnpm test`, `pnpm lint` → clean

### Task 18: Docs and release

**Files:** modify `CLAUDE.md` (architecture bullet: add-ons live in `src/main/addons/<id>/`, only import `@shared/addon-api`, host in `src/main/addonHost/`), `src/main/CLAUDE.md` if it mentions wizards, `docs/specs/2026-09-23-addons.md` (Status: implemented), `package.json` version

- [ ] Edit
- [ ] Verify: `grep -rn "wizard" CLAUDE.md src/main/CLAUDE.md` → no matches

## End-to-end verification

Run in a second dev instance with its own data dir, seeded with a copy of a real
`app.db` that has ports data and RTK enabled:

1. **Upgrade:** Settings → Add-ons shows Ports (on) and RTK (on, from the old
   config). An existing task's ports panel lists its old ports unchanged.
2. **Ports onboarding:** add a project with `package.json` scripts using a port
   and no `.dash/ports.json`; open a task → the "Set up port management?" card
   appears. "Set it up" → a `port-setup` task is created, becomes active, its
   session starts with the setup prompt, the card shows "Waiting…". When the
   agent writes `.dash/ports.json` → "Allocated N ports" → "Restart sessions"
   restarts them; `echo $<PORT_VAR>` in a shell tab prints the allocated port.
3. **Services:** panel Run → a service drawer tab appears and the row turns
   "running"; Logs focuses it; Stop stops it; closing the tab updates the row.
4. **Dismissal:** "Not for this project" → no card on other tasks of that
   project, also after a Dash restart. "Not now" → card returns after restart.
   Drawer "+" → "Service management" re-offers it.
5. **RTK:** as in Task 11's manual check.
6. **Toggles:** disable Ports → card, panel and menu item disappear at once,
   the "Restart sessions to apply" toast appears; re-enable → they return.
7. **Isolation:** make a surface throw (temporary local edit) → only that
   surface shows an error line; the rest of Dash works.
8. `pnpm run type-check && pnpm test && pnpm lint` → all clean.
