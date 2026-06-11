import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, shell } from 'electron';
import { WorkspacePortsRuntime } from '../services/WorkspacePortsRuntime';
import { portLivenessService } from '../services/PortLivenessService';
import { DatabaseService } from '../services/DatabaseService';
import { detectPortsNeed } from '../services/PortsHeuristic';
import { loadWorkspacePorts } from '../services/WorkspacePortsService';
import { ensureWatching as ensurePortsConfigWatch } from '../services/PortsConfigWatcher';

export function registerPortsIpc(): void {
  ipcMain.handle('ports:list', (_event, taskId: string) => {
    try {
      const data = WorkspacePortsRuntime.getPortsForTask(taskId);
      // Kick the liveness watcher every time the renderer asks for the list —
      // simpler than a separate "watch" handshake and keeps the watch set in
      // sync with whichever task the user is currently focused on.
      portLivenessService.watchTask(
        taskId,
        data.map((p) => p.hostPort),
      );
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ports:refresh', (_event, taskId: string) => {
    try {
      const task = DatabaseService.getTask(taskId);
      if (!task) return { success: false, error: `Task ${taskId} not found` };
      const data = WorkspacePortsRuntime.setupTask({
        taskId,
        worktreePath: task.path,
      });
      portLivenessService.watchTask(
        taskId,
        data.map((p) => p.hostPort),
      );
      // .dash/ may have just appeared (post-onboarding agent write); idempotent.
      ensurePortsConfigWatch(taskId, task.path);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Liveness snapshot for the focused task — useful for restoring state after
  // a renderer reload without waiting for the next 2s tick.
  ipcMain.handle('ports:liveness:get', (_event, taskId: string) => {
    return { success: true, data: portLivenessService.getStates(taskId) };
  });

  ipcMain.handle('ports:unwatch', (_event, taskId: string) => {
    portLivenessService.unwatchTask(taskId);
    return { success: true };
  });

  // Config watcher — ensured when the drawer mounts for a task. Watches
  // .dash/ports.json so external edits (manual tweaks, deletion, agent writes
  // outside the setup flow) are reflected in the drawer without a manual
  // refresh. Lives for the task's lifetime; no unwatch.
  ipcMain.handle('ports:watchConfig', (_event, taskId: string) => {
    try {
      const task = DatabaseService.getTask(taskId);
      if (!task) return { success: false, error: `Task ${taskId} not found` };
      ensurePortsConfigWatch(taskId, task.path);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ports:openUrl', (_event, port: number) => {
    shell.openExternal(`http://localhost:${port}`);
    return { success: true };
  });

  // Onboarding state — only fires when the task has no ports.json yet, so
  // the renderer can render a "set up port management" affordance instead of
  // hiding the panel. Returns `needsPorts: false` when the heuristic finds
  // nothing, which the panel treats identically to "already configured" —
  // the section stays hidden.
  ipcMain.handle('ports:detect', (_event, taskId: string) => {
    try {
      const task = DatabaseService.getTask(taskId);
      if (!task) return { success: false, error: `Task ${taskId} not found` };
      // Collect parser errors so the onboarding toast can show the specific
      // reason (privileged port, duplicate envVar, malformed JSON, etc.)
      // rather than just pointing at the main-process console.
      const parseErrors: string[] = [];
      if (loadWorkspacePorts(task.path, parseErrors)) {
        return {
          success: true,
          data: { needsPorts: false, signals: [], guesses: [], alreadyConfigured: true },
        };
      }
      // File exists but didn't parse → stop the polling and surface the
      // actual error. Without this branch the toast would sit on "waiting
      // for ports.json" forever even though the file is right there.
      const portsJsonPath = path.join(task.path, '.dash', 'ports.json');
      if (fs.existsSync(portsJsonPath)) {
        const reason =
          parseErrors.length > 0
            ? parseErrors.join('; ')
            : '.dash/ports.json exists but failed to parse.';
        return {
          success: true,
          data: {
            needsPorts: false,
            signals: [],
            guesses: [],
            alreadyConfigured: false,
            configError: reason,
          },
        };
      }
      const result = detectPortsNeed(task.path);
      return {
        success: true,
        data: { ...result, alreadyConfigured: false },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
