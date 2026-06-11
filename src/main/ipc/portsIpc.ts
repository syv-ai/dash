import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ipcMain, shell } from 'electron';
import { WorkspacePortsRuntime } from '../services/WorkspacePortsRuntime';
import { portLivenessService } from '../services/PortLivenessService';
import { DatabaseService } from '../services/DatabaseService';
import { detectPortsNeed } from '../services/PortsHeuristic';
import { loadWorkspacePorts } from '../services/WorkspacePortsService';
import {
  startWatching as startPortsConfigWatch,
  stopWatching as stopPortsConfigWatch,
  rearm as rearmPortsConfigWatch,
} from '../services/PortsConfigWatcher';

const execFileAsync = promisify(execFile);

// Cached after first probe — Docker Desktop's install state doesn't change
// while Dash is running, and the probe involves either a stat or a child
// process so it's worth not repeating it for every port row.
let dockerDesktopAvailable: boolean | null = null;

async function detectDockerDesktop(): Promise<boolean> {
  if (dockerDesktopAvailable !== null) return dockerDesktopAvailable;
  try {
    if (process.platform === 'darwin') {
      dockerDesktopAvailable = fs.existsSync('/Applications/Docker.app');
    } else if (process.platform === 'linux') {
      // Linux ships Docker Desktop as a separate `docker-desktop` binary on
      // PATH; the regular `docker` CLI is not enough since it might be a
      // Docker Engine install without the Desktop UI.
      try {
        const { stdout } = await execFileAsync('which', ['docker-desktop']);
        dockerDesktopAvailable = stdout.trim().length > 0;
      } catch {
        dockerDesktopAvailable = false;
      }
    } else {
      dockerDesktopAvailable = false;
    }
  } catch {
    dockerDesktopAvailable = false;
  }
  return dockerDesktopAvailable;
}

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
      // .dash/ may have just appeared (post-onboarding agent write); retry
      // a deferred arm. rearm, NOT startWatching — refresh has no matching
      // stop, and an unmatched ref would pin the watcher per click.
      rearmPortsConfigWatch(taskId);
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

  // Config watcher — armed when the drawer mounts for a task, torn down
  // when it unmounts. Watches .dash/ports.json so external edits (manual
  // tweaks, deletion, agent writes outside the setup flow) are reflected
  // in the drawer without forcing a manual refresh.
  ipcMain.handle('ports:watchConfig', (_event, taskId: string) => {
    try {
      const task = DatabaseService.getTask(taskId);
      if (!task) return { success: false, error: `Task ${taskId} not found` };
      startPortsConfigWatch(taskId, task.path);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('ports:unwatchConfig', (_event, taskId: string) => {
    stopPortsConfigWatch(taskId);
    return { success: true };
  });

  ipcMain.handle('ports:openUrl', (_event, port: number) => {
    shell.openExternal(`http://localhost:${port}`);
    return { success: true };
  });

  // Docker Desktop deep-link. We don't know which container is bound to the
  // given port without running `docker ps` (deferred), so for v1 we just
  // surface the containers dashboard and let the user pick. The icon is only
  // shown in the UI when isAvailable is true, so a no-op handler isn't
  // expected here.
  ipcMain.handle('ports:isDockerDesktopAvailable', async () => {
    return { success: true, data: await detectDockerDesktop() };
  });

  ipcMain.handle('ports:openInDocker', async () => {
    const available = await detectDockerDesktop();
    if (!available) return { success: false, error: 'Docker Desktop not installed' };
    try {
      if (process.platform === 'darwin') {
        // `open -a Docker` reliably launches AND focuses the app. The
        // docker-desktop:// URL scheme is inconsistent — registered, fires
        // a handler, but doesn't always foreground the window.
        await execFileAsync('open', ['-a', 'Docker']);
      } else if (process.platform === 'linux') {
        // Detach so Dash doesn't sit waiting for Docker Desktop to exit.
        const { spawn } = await import('child_process');
        const proc = spawn('docker-desktop', [], { detached: true, stdio: 'ignore' });
        proc.unref();
      } else {
        await shell.openExternal('docker-desktop://');
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
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
