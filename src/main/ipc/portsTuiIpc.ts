import { ipcMain, app, type BrowserWindow } from 'electron';
import crypto from 'crypto';
import path from 'path';
import * as fs from 'fs';
import { TuiSocketServer } from '../services/TuiSocketServer';
import { PortsOnboardingOrchestrator } from '../services/PortsOnboardingOrchestrator';
import { initDrawerTabsService } from './drawerTabsIpc';
import { startCommandPty, writePty } from '../services/ptyManager';
import { detectPortsNeed } from '../services/PortsHeuristic';
import { installPortsSetupCommand } from '../services/PortsSetupCommandInstaller';
import { WorkspacePortsRuntime } from '../services/WorkspacePortsRuntime';
import {
  events as portsConfigEvents,
  startWatching as startPortsConfigWatch,
} from '../services/PortsConfigWatcher';
import { hookEvents } from '../services/HookServer';
import { DatabaseService } from '../services/DatabaseService';
import { worktreeService } from '../services/WorktreeService';
import { portsDebug } from '../services/PortsDebugLog';

interface ActiveTui {
  socket: TuiSocketServer;
  orch: PortsOnboardingOrchestrator;
}

const activeTuis = new Map<string, ActiveTui>();

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

  let socket: TuiSocketServer | null = null;
  let orch: PortsOnboardingOrchestrator | null = null;
  let tabCreated = false;

  try {
    socket = new TuiSocketServer(sockPath);
    await socket.listen();

    const tab = drawerTabs.add(taskId, {
      kind: 'tui',
      label: 'Ports',
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
        installer: { install: async () => installPortsSetupCommand(cwd) },
        runtime: {
          setupTask: async (tid: string) => {
            const ports = WorkspacePortsRuntime.setupTask({
              taskId: tid,
              worktreePath: cwd,
            });
            return { count: ports.length };
          },
        },
        configWatcher: portsConfigEvents,
        hookEvents,
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
        agentSender: {
          sendKeys: async (tid: string, text: string) => writePty(tid, text),
        },
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
    return { tabId: tab.id };
  } catch (err) {
    if (orch) {
      try {
        await (orch as unknown as { teardown(): Promise<void> }).teardown?.();
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
    activeTuis.delete(taskId);
    throw err;
  }
}

/**
 * Migrate path: the user picked "New task" in CHOOSE_TASK. We:
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
  // writes .dash/ports.json and the sentinel. We have to create .dash/
  // ourselves first — startWatching no-ops if the directory doesn't exist,
  // and WorkspacePortsRuntime.setupTask's writeEnvFile only creates .dash/
  // when there are non-empty assignments. For a fresh worktree there are
  // none yet, so it never gets created and the watcher never arms.
  try {
    const dashDir = path.join(task.path, '.dash');
    if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
    WorkspacePortsRuntime.setupTask({ taskId: task.id, worktreePath: task.path });
    startPortsConfigWatch(task.id, task.path);
    portsDebug.log('migrate', 'watcher armed', {
      taskId: task.id,
      dashDir,
      exists: fs.existsSync(dashDir),
    });
  } catch (err) {
    portsDebug.log('migrate', 'ports bootstrap failed', { err: String(err) });
  }

  // Spawn the new TUI BEFORE notifying the renderer. spawnTui only adds the
  // entry to activeTuis at its very end (after socket listen, drawer tab
  // INSERT, orchestrator start, and side-car PTY spawn). If we sent the
  // 'ports:tui:migrated' event first, the renderer would switch active task,
  // its portsTuiRequestStart effect would fire, see activeTuis.has === false,
  // and race in to spawn its OWN orchestrator at initialState='onboarding'.
  // The renderer's spawnTui usually won the race because it had fewer awaits
  // before the drawerTabs.add — so the user saw an onboarding screen for the
  // newly-created port-setup task instead of the launching spinner.
  await spawnTui({
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
  });
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
      if (activeTuis.has(taskId)) {
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

  ipcMain.handle('ports:tui:close', async (_e, taskId: string) => {
    const entry = activeTuis.get(taskId);
    if (!entry) return { success: true as const };
    try {
      await entry.socket.send({ type: 'shutdown' });
    } catch {
      /* socket already gone */
    }
    setTimeout(() => {
      activeTuis.delete(taskId);
    }, 1500);
    return { success: true as const };
  });

  ipcMain.handle('ports:tui:isActive', (_e, taskId: string) => ({
    success: true as const,
    data: activeTuis.has(taskId),
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
