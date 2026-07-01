import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, parseArgsSafe, errorResponse } from './validate';
import { permissionModeSchema } from './schemas';
import {
  startDirectPty,
  startPty,
  startCommandPty,
  writePty,
  resizePty,
  killPty,
  killPtyAwait,
  killByOwner,
  sendRemoteControl,
  listForTask,
  setInitialPrompt,
  type PtyKind,
} from '../services/ptyManager';
import { DatabaseService } from '../services/DatabaseService';
import { terminalSnapshotService } from '../services/TerminalSnapshotService';
import { activityMonitor } from '../services/ActivityMonitor';
import { contextUsageService } from '../services/ContextUsageService';
import { remoteControlService } from '../services/remoteControlService';
import { TelemetryService } from '../services/TelemetryService';
import type { PermissionMode } from '@shared/types';

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
        permissionMode?: PermissionMode;
        isDark?: boolean;
      },
    ) => {
      try {
        parseArgs(
          'pty:startDirect',
          z.looseObject({
            id: z.string(),
            cwd: z.string(),
            cols: z.number(),
            rows: z.number(),
            permissionMode: permissionModeSchema.optional(),
            isDark: z.boolean().optional(),
          }),
          args,
        );
        // The agent PTY id is the bare task id — look up its name and model so a
        // fresh spawn gets `claude --name <task>` (recognizable in /resume +
        // title) and `--model <alias>` (the user's per-task model choice). Read
        // from the DB here rather than threading through the renderer, since both
        // are stable task settings resolved at spawn time.
        const task = DatabaseService.getTask(args.id);
        const result = await startDirectPty({
          ...args,
          name: task?.name,
          model: task?.model,
          sender: event.sender,
        });
        TelemetryService.capture('terminal_started', { source: 'direct' });
        return { success: true, data: result };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle(
    'pty:start',
    async (event, args: { id: string; cwd: string; cols: number; rows: number }) => {
      try {
        parseArgs(
          'pty:start',
          z.looseObject({ id: z.string(), cwd: z.string(), cols: z.number(), rows: z.number() }),
          args,
        );
        const result = await startPty({
          ...args,
          sender: event.sender,
        });
        return { success: true, data: result };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // Fire-and-forget channels (ipcMain.on instead of handle)
  ipcMain.on('pty:input', (_event, args: { id: string; data: string }) => {
    const v = parseArgsSafe('pty:input', z.looseObject({ id: z.string(), data: z.string() }), args);
    if (v === undefined) return;
    writePty(args.id, args.data);
  });

  ipcMain.on('pty:resize', (_event, args: { id: string; cols: number; rows: number }) => {
    const v = parseArgsSafe(
      'pty:resize',
      z.looseObject({ id: z.string(), cols: z.number(), rows: z.number() }),
      args,
    );
    if (v === undefined) return;
    resizePty(args.id, args.cols, args.rows);
  });

  ipcMain.on('pty:kill', (_event, id: string) => {
    const v = parseArgsSafe('pty:kill', z.string(), id);
    if (v === undefined) return;
    killPty(id);
  });

  // Awaitable kill: resolves only after the child has exited (or the grace
  // window elapsed). The renderer awaits this before respawning so a fresh
  // `claude --resume` never races the dying process for the session jsonl.
  ipcMain.handle('pty:kill-await', async (_event, id: string) => {
    try {
      parseArgs('pty:kill-await', z.string(), id);
      await killPtyAwait(id);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Snapshot handlers
  ipcMain.handle('pty:snapshot:get', async (_event, id: string) => {
    try {
      parseArgs('pty:snapshot:get', z.string(), id);
      const data = await terminalSnapshotService.getSnapshot(id);
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.on('pty:snapshot:save', (_event, id: string, payload: unknown) => {
    try {
      const v = parseArgsSafe('pty:snapshot:save', z.string(), id);
      if (v === undefined) return;
      void terminalSnapshotService.saveSnapshot(id, payload as any);
    } catch {
      // Best effort — fire-and-forget from beforeunload
    }
  });

  ipcMain.handle('pty:snapshot:clear', async (_event, id: string) => {
    try {
      parseArgs('pty:snapshot:clear', z.string(), id);
      await terminalSnapshotService.deleteSnapshot(id);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Store task context prompt in DB for SessionStart hook injection
  ipcMain.handle('pty:writeTaskContext', (_event, args: { taskId: string; prompt: string }) => {
    try {
      parseArgs(
        'pty:writeTaskContext',
        z.looseObject({ taskId: z.string(), prompt: z.string() }),
        args,
      );
      DatabaseService.setTaskContextPrompt(args.taskId, args.prompt);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Stash the task's initial prompt so the first `claude` spawn auto-submits it
  // (positional arg, submitted once the trust gate clears) instead of injecting
  // it as silent SessionStart context the agent never acts on. One-shot: consumed
  // by the first startDirectPty for the task. Must be set before the terminal
  // mounts, which the renderer guarantees by awaiting this in createTask.
  ipcMain.handle('pty:setInitialPrompt', (_event, args: { taskId: string; prompt: string }) => {
    try {
      parseArgs(
        'pty:setInitialPrompt',
        z.looseObject({ taskId: z.string(), prompt: z.string() }),
        args,
      );
      setInitialPrompt(args.taskId, args.prompt);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Activity monitor
  ipcMain.handle('pty:activity:getAll', () => {
    return { success: true, data: activityMonitor.getAll() };
  });

  // Remote control
  ipcMain.handle('pty:remoteControl:enable', (_event, ptyId: string) => {
    try {
      parseArgs('pty:remoteControl:enable', z.string(), ptyId);
      sendRemoteControl(ptyId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('pty:remoteControl:getAllStates', () => {
    return { success: true, data: remoteControlService.getAllStates() };
  });

  // Status line data (context + cost + rate limits)
  ipcMain.handle('pty:statusLine:getAll', () => {
    return { success: true, data: contextUsageService.getAllStatusLine() };
  });

  ipcMain.handle(
    'pty:listForTask',
    (_event, taskId: string, opts?: { kinds?: PtyKind[]; featureId?: string }) => {
      parseArgs('pty:listForTask', z.string(), taskId);
      parseArgs(
        'pty:listForTask',
        z
          .looseObject({
            kinds: z.array(z.enum(['agent', 'shell', 'tui', 'service'])).optional(),
            featureId: z.string().optional(),
          })
          .optional(),
        opts,
      );
      return { success: true, data: listForTask(taskId, opts) };
    },
  );

  ipcMain.handle(
    'pty:startCommand',
    async (
      event,
      opts: {
        id: string;
        command: string;
        args: string[];
        cwd: string;
        cols: number;
        rows: number;
        env?: Record<string, string>;
        taskId: string;
        featureId: string;
      },
    ) => {
      try {
        parseArgs(
          'pty:startCommand',
          z.looseObject({
            id: z.string(),
            command: z.string(),
            args: z.array(z.string()),
            cwd: z.string(),
            cols: z.number(),
            rows: z.number(),
            env: z.record(z.string(), z.string()).optional(),
            taskId: z.string(),
            featureId: z.string(),
          }),
          opts,
        );
        const result = await startCommandPty({ ...opts, owner: event.sender });
        return { success: true, data: result };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
