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
import { events as portsConfigEvents } from '../services/PortsConfigWatcher';
import { DatabaseService } from '../services/DatabaseService';

interface ActiveTui {
  socket: TuiSocketServer;
  orch: PortsOnboardingOrchestrator;
}

const activeTuis = new Map<string, ActiveTui>();

const dismissStore = {
  isDismissed: (pid: string) => DatabaseService.isPortsSetupDismissed(pid),
  markDismissed: (pid: string) => DatabaseService.markPortsSetupDismissed(pid),
};

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
      const { taskId, projectId, taskName, projectName, cwd, cols, rows } = payload;

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

      const sockDir = path.join(app.getPath('userData'), 'sockets');
      const sockPath = path.join(
        sockDir,
        `ports-tui-${taskId}-${crypto.randomBytes(4).toString('hex')}.sock`,
      );

      const drawerTabs = initDrawerTabsService();
      const tabIdLocal = `ports-tui:${taskId}`;

      // All side-effects are gated behind the spawn — if any part of setup
      // throws, we tear down everything we created so the user doesn't end up
      // with an empty Ports tab backed by a shell. The legacy code did the tab
      // INSERT before spawning, which is why a failed side-car spawn previously
      // surfaced as "shell prompt in the Ports tab" instead of a clean error.
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
          initialState: 'onboarding',
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
            sessionRegistry: {
              restartAllForTask: async (tid: string) => {
                const win = opts.getMainWindow();
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
          },
        });
        orch.setTabId(tab.id);
        await orch.start();

        // Compiled main is at dist/main/main/ipc/portsTuiIpc.js; bundle ships at
        // dist/main/main/scripts/portsTui.js. __dirname keeps the resolution
        // correct in dev. In packaged builds the bundle lives inside app.asar,
        // but node-pty can't spawn from there — electron-builder unpacks
        // dist/main/main/scripts/** to app.asar.unpacked (see package.json
        // build.asarUnpack), and the standard Electron trick is to swap the
        // path. The replace is a no-op in dev.
        const scriptPath = path
          .join(__dirname, '..', 'scripts', 'portsTui.js')
          .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
        if (!fs.existsSync(scriptPath)) {
          throw new Error(
            `Ports TUI bundle missing at ${scriptPath}. Run \`pnpm build:tui\` and try again.`,
          );
        }

        const win = opts.getMainWindow();
        await startCommandPty({
          id: tab.id,
          command: process.execPath,
          args: [scriptPath],
          cwd,
          cols,
          rows,
          env: {
            DASH_TUI_SOCKET: sockPath,
            DASH_TUI_INITIAL_STATE: 'onboarding',
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
        return {
          success: true as const,
          data: { started: true as const, tabId: tab.id },
        };
      } catch (err) {
        console.error('[portsTuiIpc] requestStart failed for task', taskId, err);
        // Roll back partial state so the user doesn't see an orphaned Ports tab.
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
