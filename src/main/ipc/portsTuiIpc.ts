import { ipcMain, app, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import path from 'path';
import * as fs from 'fs';
import { TuiSocketServer } from '../services/TuiSocketServer';
import type { PortsMainToTui, PortsTuiToMain } from '../../shared/portsTuiProtocol';
import { PortsOnboardingOrchestrator } from '../services/PortsOnboardingOrchestrator';
import { initDrawerTabsService } from './drawerTabsIpc';
import { startCommandPty, setInitialPrompt } from '../services/ptyManager';
import { detectPortsNeed } from '../services/PortsHeuristic';
import { buildPortsSetupPrompt } from '../services/PortsSetupPrompt';
import { WorkspacePortsRuntime } from '../services/WorkspacePortsRuntime';
import {
  events as portsConfigEvents,
  ensureWatching as ensurePortsConfigWatch,
} from '../services/PortsConfigWatcher';
import { DatabaseService } from '../services/DatabaseService';
import { worktreeService } from '../services/WorktreeService';
import { portsDebug } from '../services/PortsDebugLog';

interface ActiveTui {
  socket: TuiSocketServer<PortsTuiToMain, PortsMainToTui>;
  orch: PortsOnboardingOrchestrator;
}

const activeTuis = new Map<string, ActiveTui>();
/**
 * Tasks whose `spawnTui` is in flight but hasn't yet registered in `activeTuis`.
 * The renderer's `portsTuiRequestStart` effect (and the `ports:tui:isActive`
 * IPC) treats `pending` the same as `active` so the renderer's effect bails
 * during the migrate window — otherwise it would see `isActive=false` between
 * "main switched the renderer to the new task" and "main finished wiring the
 * new orchestrator", and would race in to spawn its own `onboarding`-state
 * orchestrator for the new task.
 */
const pendingTuis = new Set<string>();
/**
 * Tasks whose TUI finished this session (declined, completed, migrated away,
 * or closed). Consulted alongside activeTuis/pendingTuis so the renderer's
 * task-switch effect doesn't re-spawn onboarding every time the user returns
 * to the task. Session-scoped on purpose: a Dash restart asks again. Spawn
 * FAILURES ('error' reason, or rollback before registration) are deliberately
 * NOT suppressed so the user can retry by switching tasks.
 */
const suppressedTuis = new Set<string>();

const dismissStore = {
  isDismissed: (pid: string) => DatabaseService.isPortsSetupDismissed(pid),
  markDismissed: (pid: string) => DatabaseService.markPortsSetupDismissed(pid),
};

function resolveScriptPath(): string {
  return path
    .join(__dirname, '..', 'scripts', 'portsTui.js')
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

/**
 * One-time best-effort migration from the legacy dismissed-projects.json file
 * (used by the pre-DB ports onboarding) into the projects table. Runs at boot;
 * deletes the file once each id has been marked dismissed in SQLite.
 */
function migrateLegacyDismissFile(): void {
  const legacyPath = path.join(app.getPath('userData'), 'dismissed-projects.json');
  let state: Record<string, true> = {};
  try {
    state = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch {
    return; // no file, nothing to migrate
  }
  for (const pid of Object.keys(state)) {
    try {
      DatabaseService.markPortsSetupDismissed(pid);
    } catch {
      /* unknown project — skip */
    }
  }
  try {
    fs.unlinkSync(legacyPath);
  } catch {
    /* already gone */
  }
}

interface SpawnTuiOpts {
  taskId: string;
  projectId: string;
  taskName: string;
  projectName: string;
  cwd: string;
  cols: number;
  rows: number;
  initialState: 'onboarding' | 'launching';
  presetSignalsGuesses?: { signals: string[]; guesses: string[] };
  getMainWindow: () => BrowserWindow | null;
}

interface SpawnResult {
  tabId: string;
}

/**
 * Spawn the orchestrator + socket server + side-car PTY for a task. Called
 * directly by the requestStart IPC and by the migrate callback when the user
 * picks "New task" — both paths share this assembly.
 *
 * Rolls back partial state (socket, drawer tab, activeTuis map) on any throw
 * so a failed spawn doesn't leave an orphaned Ports tab in the drawer.
 */
async function spawnTui(opts: SpawnTuiOpts): Promise<SpawnResult> {
  const {
    taskId,
    projectId,
    taskName,
    projectName,
    cwd,
    cols,
    rows,
    initialState,
    presetSignalsGuesses,
    getMainWindow,
  } = opts;

  const sockDir = path.join(app.getPath('userData'), 'sockets');
  const sockPath = path.join(
    sockDir,
    `ports-tui-${taskId}-${crypto.randomBytes(4).toString('hex')}.sock`,
  );

  const drawerTabs = initDrawerTabsService();
  const tabIdLocal = `ports-tui:${taskId}`;

  let socket: TuiSocketServer<PortsTuiToMain, PortsMainToTui> | null = null;
  let orch: PortsOnboardingOrchestrator | null = null;
  let tabCreated = false;
  // Set once the TUI is registered in activeTuis. The orchestrator's
  // onTeardown fires on the rollback path too — before registration it must
  // neither delete a live entry nor suppress a retry.
  let registered = false;
  pendingTuis.add(taskId);

  try {
    socket = new TuiSocketServer<PortsTuiToMain, PortsMainToTui>(sockPath);
    await socket.listen();

    const tab = drawerTabs.add(taskId, {
      kind: 'tui',
      label: 'Set up ports',
      featureId: 'ports',
      id: tabIdLocal,
    });
    tabCreated = true;

    orch = new PortsOnboardingOrchestrator({
      taskId,
      projectId,
      taskName,
      projectName,
      initialState,
      presetSignalsGuesses,
      socket,
      services: {
        heuristic: {
          run: async () => {
            const result = detectPortsNeed(cwd);
            return {
              signals: result.signals,
              guesses: result.guesses.map((g) => `${g.label} (${g.envVar} @ ${g.defaultPort})`),
            };
          },
        },
        runtime: {
          // The watcher already re-ran WorkspacePortsRuntime.setupTask before
          // emitting ports:config — only the count is needed here.
          getPortCount: async (tid: string) => WorkspacePortsRuntime.getPortsForTask(tid).length,
        },
        configWatcher: {
          events: portsConfigEvents,
          startWatching: () => ensurePortsConfigWatch(taskId, cwd),
          stopWatching: () => {
            /* watcher is task-lifetime now; nothing to release */
          },
        },
        sessionRegistry: {
          restartAllForTask: async (tid: string) => {
            const win = getMainWindow();
            win?.webContents.send('ports:restart-task', tid);
          },
        },
        drawerTabs: {
          add: (tid: string, o: unknown) => drawerTabs.add(tid, o as never),
          close: (id: string) => drawerTabs.close(id),
        },
        dismissStore,
        migrate: async ({ signals, guesses }) => {
          await handleMigrate({
            currentTaskId: taskId,
            currentProjectId: projectId,
            signals,
            guesses,
            cols,
            rows,
            getMainWindow,
          });
        },
        onTeardown: (reason) => {
          if (!registered) return;
          activeTuis.delete(taskId);
          if (reason !== 'error') suppressedTuis.add(taskId);
        },
      },
    });
    orch.setTabId(tab.id);
    await orch.start();

    const scriptPath = resolveScriptPath();
    if (!fs.existsSync(scriptPath)) {
      throw new Error(
        `Ports TUI bundle missing at ${scriptPath}. Run \`pnpm build:tui\` and try again.`,
      );
    }

    const win = getMainWindow();
    await startCommandPty({
      id: tab.id,
      command: process.execPath,
      args: [scriptPath],
      cwd,
      cols,
      rows,
      env: {
        DASH_TUI_SOCKET: sockPath,
        DASH_TUI_INITIAL_STATE: initialState,
        DASH_TUI_TASK_NAME: taskName,
        DASH_TUI_PROJECT_NAME: projectName,
        // Electron binary runs as plain Node when this is set.
        ELECTRON_RUN_AS_NODE: '1',
      },
      owner: win?.webContents ?? null,
      taskId,
      featureId: 'ports',
    });

    activeTuis.set(taskId, { socket, orch });
    registered = true;
    return { tabId: tab.id };
  } catch (err) {
    if (orch) {
      try {
        await orch.teardown();
      } catch {
        /* best effort */
      }
    }
    if (socket) {
      try {
        await socket.close();
      } catch {
        /* best effort */
      }
    }
    if (tabCreated) {
      try {
        drawerTabs.close(tabIdLocal);
      } catch {
        /* best effort */
      }
    }
    throw err;
  } finally {
    pendingTuis.delete(taskId);
  }
}

/**
 * Migrate path: the user picked "Set it up" on the ONBOARDING screen. We:
 *   1. Create a `port-setup` worktree task on a new branch from the project's
 *      default base (push to remote is skipped — this branch is local-only
 *      throwaway in the common case).
 *   2. Persist the task in SQLite.
 *   3. Ask the renderer to switch its active task to the new one (the
 *      portsTuiRequestStart effect will refuse to fire because we'll have
 *      already spawned the new orchestrator below).
 *   4. Spawn a fresh orchestrator + side-car for the new task at LAUNCHING,
 *      pre-seeded with the original task's signals/guesses.
 */
async function handleMigrate(args: {
  currentTaskId: string;
  currentProjectId: string;
  signals: string[];
  guesses: string[];
  cols: number;
  rows: number;
  getMainWindow: () => BrowserWindow | null;
}): Promise<void> {
  const project = DatabaseService.getProjects().find((p) => p.id === args.currentProjectId);
  if (!project) throw new Error(`project ${args.currentProjectId} not found`);

  const worktreeInfo = await worktreeService.createWorktree(project.path, 'port-setup', {
    projectId: args.currentProjectId,
    pushRemote: false,
  });

  const task = DatabaseService.saveTask({
    id: worktreeInfo.id,
    projectId: args.currentProjectId,
    name: 'port-setup',
    branch: worktreeInfo.branch,
    path: worktreeInfo.path,
    useWorktree: true,
    branchCreatedByDash: true,
  });

  // Arm the file watcher so the orchestrator hears about it when the agent
  // writes .dash/ports.json and the sentinel. We mkdir `.dash/` defensively
  // so `fs.watch` attaches immediately — the deferred-arm refcount in
  // PortsConfigWatcher would also retry on the next startWatching call,
  // but doing it eagerly avoids a race where the agent races us to write
  // ports.json before anyone has called startWatching a second time.
  try {
    const dashDir = path.join(task.path, '.dash');
    if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
    // A committed setup-complete from a previous run (pre-gitignore repos)
    // would land in the fresh worktree; the agent's step 1 deletes it too,
    // but main owning the reset keeps the DONE trigger trustworthy even if
    // the agent skips instructions.
    fs.rmSync(path.join(dashDir, 'setup-complete'), { force: true });
    WorkspacePortsRuntime.setupTask({ taskId: task.id, worktreePath: task.path });
    ensurePortsConfigWatch(task.id, task.path);
    portsDebug.log('migrate', 'watcher armed', {
      taskId: task.id,
      dashDir,
      exists: fs.existsSync(dashDir),
    });
  } catch (err) {
    portsDebug.log('migrate', 'ports bootstrap failed', { err: String(err) });
  }

  // Stash the FULL setup prompt as the agent's initial positional arg.
  // CC auto-submits this once the user accepts the trust gate, so the user
  // goes "click new task → dismiss trust modal → setup runs" with zero
  // interaction in the Ports tab — and we don't install a slash-command
  // .md file in the new worktree (no per-worktree footprint, no
  // .gitignore mutation).
  try {
    const setupPrompt = buildPortsSetupPrompt({
      signals: args.signals,
      guesses: args.guesses,
    });
    setInitialPrompt(task.id, setupPrompt);
    portsDebug.log('migrate', 'initial prompt stashed', {
      taskId: task.id,
      promptLen: setupPrompt.length,
    });
  } catch (err) {
    // Best effort — if the builder somehow fails, the orchestrator still
    // surfaces the 30-min ports.json timeout, and the user can re-run
    // setup from the Dash UI.
    portsDebug.log('migrate', 'initial-prompt build failed', { err: String(err) });
  }

  // Kick off the spawn synchronously so `pendingTuis.has(task.id)` is true
  // before we notify the renderer. The renderer's portsTuiRequestStart effect
  // checks `ports:tui:isActive` which now consults `pendingTuis ∪ activeTuis`
  // and bails — without the pending guard, the renderer would race in to
  // spawn its own `onboarding`-state orchestrator for the new task.
  //
  // Don't await the full spawn before sending the IPC: spawnTui's side-car
  // PTY + socket dance can take long enough that the user sees the old
  // task's "migrating" spinner stuck for seconds while everything is already
  // resolved on disk. We still await it afterwards so failures surface to
  // the old orchestrator's services.migrate() caller.
  const spawnPromise = spawnTui({
    taskId: task.id,
    projectId: args.currentProjectId,
    taskName: task.name,
    projectName: project.name,
    cwd: task.path,
    cols: args.cols,
    rows: args.rows,
    initialState: 'launching',
    presetSignalsGuesses: { signals: args.signals, guesses: args.guesses },
    getMainWindow: args.getMainWindow,
  });

  const win = args.getMainWindow();
  win?.webContents.send('ports:tui:migrated', {
    fromTaskId: args.currentTaskId,
    toTaskId: task.id,
    projectId: args.currentProjectId,
  });

  try {
    await spawnPromise;
  } catch (err) {
    // The renderer has already switched to the new task, so the old TUI's
    // error screen (rendered by our caller's exit('error')) is off-screen.
    // Surface the failure where the user is actually looking.
    const w = args.getMainWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('app:toast', {
        message: `Port-setup TUI failed to start: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    throw err;
  }
}

export function registerPortsTuiIpc(opts: { getMainWindow: () => BrowserWindow | null }): void {
  ipcMain.handle(
    'ports:tui:requestStart',
    async (
      _e,
      payload: {
        taskId: string;
        projectId: string;
        taskName: string;
        projectName: string;
        cwd: string;
        cols: number;
        rows: number;
      },
    ) => {
      const { taskId, projectId } = payload;

      if (dismissStore.isDismissed(projectId)) {
        return {
          success: true as const,
          data: { started: false as const, reason: 'dismissed' as const },
        };
      }
      if (activeTuis.has(taskId) || pendingTuis.has(taskId) || suppressedTuis.has(taskId)) {
        return {
          success: true as const,
          data: { started: false as const, reason: 'already-active' as const },
        };
      }

      try {
        const { tabId } = await spawnTui({
          ...payload,
          initialState: 'onboarding',
          getMainWindow: opts.getMainWindow,
        });
        return {
          success: true as const,
          data: { started: true as const, tabId },
        };
      } catch (err) {
        console.error('[portsTuiIpc] requestStart failed for task', taskId, err);
        return {
          success: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('ports:tui:isActive', (_e, taskId: string) => ({
    success: true as const,
    data: activeTuis.has(taskId) || pendingTuis.has(taskId) || suppressedTuis.has(taskId),
  }));
}

/**
 * Clean up TUI state left behind by the previous run. Three things:
 *   1. Migrate the legacy dismissed-projects.json into projects.ports_setup_dismissed_at.
 *   2. Socket files in userData/sockets/ — orphaned by the kernel on crash.
 *   3. drawer_tabs rows with kind='tui' — the orchestrator + side-car that
 *      owned them are gone, but the row would otherwise persist and collide
 *      with the next portsTuiRequestStart's INSERT.
 */
export function cleanupOrphanSockets(): void {
  migrateLegacyDismissFile();

  const dir = path.join(app.getPath('userData'), 'sockets');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('ports-tui-')) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          /* gone */
        }
      }
    }
  } catch {
    /* dir doesn't exist yet */
  }
  try {
    initDrawerTabsService().sweepTuiTabs();
  } catch (err) {
    console.warn('[portsTuiIpc] sweepTuiTabs failed:', err);
  }
}
