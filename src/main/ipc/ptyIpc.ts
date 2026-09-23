import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, parseArgsSafe, errorResponse } from './validate';
import { permissionModeSchema } from './schemas';
import {
  startDirectPty,
  startPty,
  writePty,
  resizePty,
  killPty,
  killPtyAwait,
  killByOwner,
  sendRemoteControl,
  listForTask,
  setInitialPrompt,
  restartTaskSession,
  stopTaskSession,
  type PtyKind,
} from '../services/ptyManager';
import { DatabaseService } from '../services/DatabaseService';
import { terminalSnapshotService } from '../services/TerminalSnapshotService';
import { activityMonitor } from '../services/ActivityMonitor';
import { contextUsageService } from '../services/ContextUsageService';
import { remoteControlService } from '../services/remoteControlService';
import { TelemetryService } from '../services/TelemetryService';
import { describeUnsupportedClaude } from '../services/claudeCli';
import { IpcError } from './ipcErrors';
import type { PermissionMode } from '@shared/types';

/**
 * Await the startup `claude --version` probe and throw an `UNSUPPORTED_CLI`
 * IpcError when the CLI is missing or older than MIN_CLAUDE_VERSION.
 */
async function requireSupportedClaude(): Promise<void> {
  const main = await import('../main');
  await main.detectClaudeCli();
  const reason = describeUnsupportedClaude(main.claudeCliCache);
  if (reason) throw new IpcError(reason, 'UNSUPPORTED_CLI');
}

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
        // Hard floor: refuse to start a task session on a missing or too-old
        // CLI. The renderer normally never gets here (MainContent gates on
        // detectClaude), so this is the defense in depth that keeps a stale
        // renderer from falling back to a shell in the task pane.
        await requireSupportedClaude();

        // The agent PTY id is the bare task id — look up its name, model and
        // recorded supervisor job so a dispatch gets `--name <task>` and
        // `--model <alias>`, and an existing job is attached rather than
        // re-dispatched. Read from the DB here rather than threading through
        // the renderer, since all are stable task settings resolved at spawn.
        const task = DatabaseService.getTask(args.id);
        const result = await startDirectPty({
          ...args,
          name: task?.name,
          model: task?.model,
          previousPath: task?.previousPath,
          jobId: task?.jobId,
          sessionId: task?.sessionId,
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

  // Put the task to sleep: `claude stop` its supervisor job (the attach
  // client goes with it). Killing the agent PTY alone only detaches the
  // client — the session keeps running — so the renderer's "Put to sleep"
  // path calls this instead of pty:kill.
  ipcMain.handle('pty:stopSession', async (_event, taskId: string) => {
    try {
      parseArgs('pty:stopSession', z.string(), taskId);
      await stopTaskSession(taskId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Re-dispatch the task's session (stop + rm; the next startDirect resumes
  // the same session id in a fresh job with a fresh environment). The
  // renderer's restart path awaits this before re-attaching.
  ipcMain.handle('pty:restartSession', async (_event, taskId: string) => {
    try {
      parseArgs('pty:restartSession', z.string(), taskId);
      await restartTaskSession(taskId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Snapshot handlers (shell and service tabs; agent panes repaint on attach)
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
            kinds: z.array(z.enum(['agent', 'shell', 'service'])).optional(),
            featureId: z.string().optional(),
          })
          .optional(),
        opts,
      );
      return { success: true, data: listForTask(taskId, opts) };
    },
  );
}
