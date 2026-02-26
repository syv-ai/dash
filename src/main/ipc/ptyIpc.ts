import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  startDirectPty,
  startPty,
  writePty,
  resizePty,
  killPty,
  killByOwner,
  writeTaskContext,
  sendRemoteControl,
} from '../services/ptyManager';
import { terminalSnapshotService } from '../services/TerminalSnapshotService';
import { activityMonitor } from '../services/ActivityMonitor';
import { remoteControlService } from '../services/remoteControlService';

export function registerPtyIpc(): void {
  ipcMain.handle(
    'pty:startDirect',
    async (
      event,
      args: {
        id: string;
        cwd: string;
        cols: number;
        rows: number;
        autoApprove?: boolean;
        resume?: boolean;
        isDark?: boolean;
      },
    ) => {
      try {
        const result = await startDirectPty({
          ...args,
          sender: event.sender,
        });
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'pty:start',
    async (event, args: { id: string; cwd: string; cols: number; rows: number }) => {
      try {
        const result = await startPty({
          ...args,
          sender: event.sender,
        });
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Fire-and-forget channels (ipcMain.on instead of handle)
  ipcMain.on('pty:input', (_event, args: { id: string; data: string }) => {
    writePty(args.id, args.data);
  });

  ipcMain.on('pty:resize', (_event, args: { id: string; cols: number; rows: number }) => {
    resizePty(args.id, args.cols, args.rows);
  });

  ipcMain.on('pty:kill', (_event, id: string) => {
    killPty(id);
  });

  // Snapshot handlers
  ipcMain.handle('pty:snapshot:get', async (_event, id: string) => {
    try {
      const data = await terminalSnapshotService.getSnapshot(id);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.on('pty:snapshot:save', (_event, id: string, payload: unknown) => {
    try {
      terminalSnapshotService.saveSnapshot(id, payload as any);
    } catch {
      // Best effort — fire-and-forget from beforeunload
    }
  });

  ipcMain.handle('pty:snapshot:clear', async (_event, id: string) => {
    try {
      await terminalSnapshotService.deleteSnapshot(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Check if a Claude session exists for a given working directory
  ipcMain.handle('pty:hasClaudeSession', async (_event, cwd: string) => {
    try {
      return { success: true, data: hasClaudeSession(cwd) };
    } catch (error) {
      return { success: false, data: false, error: String(error) };
    }
  });

  // Write task context for SessionStart hook
  ipcMain.handle(
    'pty:writeTaskContext',
    (
      _event,
      args: {
        cwd: string;
        prompt: string;
        meta?: { issueNumbers: number[]; gitRemote?: string };
      },
    ) => {
      try {
        writeTaskContext(args.cwd, args.prompt, args.meta);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Activity monitor
  ipcMain.handle('pty:activity:getAll', () => {
    return { success: true, data: activityMonitor.getAll() };
  });

  // Remote control
  ipcMain.handle('pty:remoteControl:enable', (_event, ptyId: string) => {
    try {
      sendRemoteControl(ptyId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('pty:remoteControl:getAllStates', () => {
    return { success: true, data: remoteControlService.getAllStates() };
  });
}

/**
 * Check if Claude Code has an existing session for the given working directory.
 * Claude stores sessions in ~/.claude/projects/ with various naming schemes.
 */
function hasClaudeSession(cwd: string): boolean {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return false;

    // Check hash-based directory name
    const cwdHash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
    if (fs.existsSync(path.join(projectsDir, cwdHash))) return true;

    // Check path-based directory name (slashes replaced with hyphens)
    const pathBasedName = cwd.replace(/\//g, '-');
    if (fs.existsSync(path.join(projectsDir, pathBasedName))) return true;

    // Scan for partial path match (last 3 segments)
    const cwdParts = cwd.split('/').filter((p) => p.length > 0);
    const lastParts = cwdParts.slice(-3).join('-');
    const dirs = fs.readdirSync(projectsDir);
    return dirs.some((dir) => dir.includes(lastParts));
  } catch {
    return false;
  }
}
