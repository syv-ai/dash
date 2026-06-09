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

interface ActiveTui {
  socket: TuiSocketServer;
  orch: PortsOnboardingOrchestrator;
}

const activeTuis = new Map<string, ActiveTui>();

/**
 * Project-keyed dismiss store. Persisted to userData so 'Not relevant for this
 * project' sticks across Dash launches. Mirrors the toast's prior storage at
 * the same lifecycle layer (project-scoped, set once).
 */
function dismissStore() {
  const file = path.join(app.getPath('userData'), 'dismissed-projects.json');
  let state: Record<string, true> = {};
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* fresh */
  }
  return {
    isDismissed: (pid: string) => Boolean(state[pid]),
    markDismissed: (pid: string) => {
      state[pid] = true;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
      } catch {
        /* already exists */
      }
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    },
  };
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
      const store = dismissStore();
      if (store.isDismissed(projectId)) {
        return { success: true as const, data: { started: false, reason: 'dismissed' as const } };
      }
      if (activeTuis.has(taskId)) {
        return {
          success: true as const,
          data: { started: false, reason: 'already-active' as const },
        };
      }

      const sockDir = path.join(app.getPath('userData'), 'sockets');
      const sockPath = path.join(
        sockDir,
        `ports-tui-${taskId}-${crypto.randomBytes(4).toString('hex')}.sock`,
      );

      const socket = new TuiSocketServer(sockPath);
      await socket.listen();

      const drawerTabs = initDrawerTabsService();
      const tab = drawerTabs.add(taskId, {
        kind: 'tui',
        label: 'Ports',
        featureId: 'ports',
        id: `ports-tui:${taskId}`,
      });

      const orch = new PortsOnboardingOrchestrator({
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
                // PortGuess → "LABEL (ENV_VAR @ defaultPort)" for the side-car
                guesses: result.guesses.map((g) => `${g.label} (${g.envVar} @ ${g.defaultPort})`),
              };
            },
          },
          installer: {
            install: async () => installPortsSetupCommand(cwd),
          },
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
          dismissStore: store,
          agentSender: {
            sendKeys: async (tid: string, text: string) => {
              writePty(tid, text);
            },
          },
        },
      });
      orch.setTabId(tab.id);
      await orch.start();

      activeTuis.set(taskId, { socket, orch });

      const scriptPath = app.isPackaged
        ? path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'dist',
            'main',
            'scripts',
            'portsTui.js',
          )
        : path.join(app.getAppPath(), 'dist', 'main', 'scripts', 'portsTui.js');

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
          // ELECTRON_RUN_AS_NODE=1 so process.execPath (Electron binary) runs
          // as plain Node instead of opening a new app window.
          ELECTRON_RUN_AS_NODE: '1',
        },
        owner: win?.webContents ?? null,
        taskId,
        featureId: 'ports',
      });

      return {
        success: true as const,
        data: { started: true as const, tabId: tab.id },
      };
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

/** Cleanup leftover socket files at boot (orphaned by a previous crash). */
export function cleanupOrphanSockets(): void {
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
}
