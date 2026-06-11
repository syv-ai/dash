import { ipcMain, BrowserWindow } from 'electron';
import { execFile, spawn } from 'child_process';
import { ServiceRunner } from '../services/ServiceRunner';
import { DatabaseService } from '../services/DatabaseService';
import { WorkspacePortsRuntime } from '../services/WorkspacePortsRuntime';
import { portLivenessService } from '../services/PortLivenessService';
import { initDrawerTabsService } from './drawerTabsIpc';
import { startCommandPty, killPty, hasPty } from '../services/ptyManager';
import { terminalSnapshotService } from '../services/TerminalSnapshotService';
import type { TaskPort } from '@shared/types';

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/** Short-lived command via the user's login shell; never rejects. */
function execViaShell(command: string, cwd: string): Promise<{ code: number; stderrTail: string }> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/sh';
    const child = spawn(shell, ['-lc', command], { cwd });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr = (stderr + String(c)).slice(-400);
    });
    child.on('error', (err) => resolve({ code: 127, stderrTail: String(err.message) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stderrTail: stderr.trim() }));
  });
}

/** PIDs listening on a TCP port. Exit 1 = nothing listening; ENOENT = no lsof. */
function lsofPids(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `tcp:${port}`], (err, stdout) => {
      if (err) return resolve([]);
      resolve(
        stdout
          .split('\n')
          .map((l) => parseInt(l.trim(), 10))
          .filter((n) => Number.isInteger(n) && n > 0),
      );
    });
  });
}

let runner: ServiceRunner | null = null;

export function getServiceRunner(): ServiceRunner {
  if (!runner) {
    runner = new ServiceRunner({
      getTaskPath: (taskId) => DatabaseService.getTask(taskId)?.path,
      getPorts: (taskId) => WorkspacePortsRuntime.getPortsForTask(taskId),
      portEnv: (taskId) => WorkspacePortsRuntime.getEnvForTask(taskId),
      clearSnapshot: (tabId) => {
        void terminalSnapshotService.deleteSnapshot(tabId);
      },
      drawerTabsAdd: (taskId, opts) => initDrawerTabsService().add(taskId, opts as never),
      drawerTabsCloseIfExists: (tabId) => initDrawerTabsService().close(tabId),
      startPty: (opts) => startCommandPty(opts as never),
      killPty: (id) => killPty(id),
      ptyAlive: (id) => hasPty(id),
      exec: execViaShell,
      lsofPids,
      killPid: (pid) => {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* already gone or not permitted */
        }
      },
      liveness: (taskId, hostPort) => portLivenessService.getStates(taskId)[hostPort] ?? 'unknown',
      notifyChanged: (taskId) => broadcast('ports:service:changed', { taskId }),
      toast: (message) => broadcast('app:toast', { message }),
      focusTab: (taskId, tabId) => broadcast('ports:service:focusTab', { taskId, tabId }),
      shell: process.env.SHELL || '/bin/sh',
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
  }
  return runner;
}

export function registerServicesIpc(): void {
  ipcMain.handle('ports:service:start', async (_e, taskId: string, port: TaskPort) => {
    const r = await getServiceRunner().start(taskId, port);
    return r.ok
      ? { success: true as const }
      : { success: false as const, error: r.message ?? 'start failed' };
  });
  ipcMain.handle('ports:service:stop', async (_e, taskId: string, port: TaskPort) => {
    const r = await getServiceRunner().stop(taskId, port);
    return r.ok
      ? { success: true as const }
      : { success: false as const, error: r.message ?? 'stop failed' };
  });
  ipcMain.handle('ports:service:logs', async (_e, taskId: string, port: TaskPort) => {
    const r = await getServiceRunner().logs(taskId, port);
    return r.ok
      ? { success: true as const }
      : { success: false as const, error: r.message ?? 'logs failed' };
  });
  ipcMain.handle('ports:service:startAll', async (_e, taskId: string) => ({
    success: true as const,
    data: await getServiceRunner().startAll(taskId),
  }));
  ipcMain.handle('ports:service:status', (_e, taskId: string) => ({
    success: true as const,
    data: getServiceRunner().status(taskId),
  }));
}
