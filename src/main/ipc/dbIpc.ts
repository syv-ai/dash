import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { projectInputSchema, taskInputSchema } from './schemas';
import { DatabaseService } from '../services/DatabaseService';
import { TelemetryService } from '../services/TelemetryService';
import { WorkspacePortsRuntime } from '../services/WorkspacePortsRuntime';
import {
  ensureWatching as ensurePortsConfigWatch,
  stop as stopPortsConfigWatch,
} from '../services/PortsConfigWatcher';
import { discardInitialPrompt, stopTaskSession, removeTaskSession } from '../services/ptyManager';
import { getTuiHost } from '../tui/hostInstance';
import { removeShellHistory } from '../services/ptyShellConfig';

export function registerDbIpc(): void {
  // ── Projects ─────────────────────────────────────────────

  ipcMain.handle('db:getProjects', () => {
    try {
      const data = DatabaseService.getProjects();
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('db:saveProject', (_event, project) => {
    try {
      parseArgs('db:saveProject', projectInputSchema, project);
      const isNew = !project.id;
      const data = DatabaseService.saveProject(project);
      if (isNew) TelemetryService.capture('project_added');
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('db:deleteProject', (_event, id: string) => {
    try {
      parseArgs('db:deleteProject', z.string(), id);
      DatabaseService.deleteProject(id);
      TelemetryService.capture('project_deleted');
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('db:archiveProject', async (_event, id: string) => {
    try {
      parseArgs('db:archiveProject', z.string(), id);
      // Every live session in the project sleeps (`claude stop`), as with an
      // archived task; tasks keep their own archived state, so restoring the
      // project brings it back as it was.
      const live = DatabaseService.getTasks(id).filter((t) => t.jobId && !t.archivedAt);
      await Promise.all(
        live.map((t) =>
          stopTaskSession(t.id).catch((err) =>
            console.warn(`[db:archiveProject] session stop failed for ${t.name}:`, err),
          ),
        ),
      );
      DatabaseService.setProjectArchived(id, true);
      TelemetryService.capture('project_archived');
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('db:restoreProject', (_event, id: string) => {
    try {
      parseArgs('db:restoreProject', z.string(), id);
      DatabaseService.setProjectArchived(id, false);
      TelemetryService.capture('project_restored');
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // ── Tasks ────────────────────────────────────────────────

  ipcMain.handle('db:getTasks', (_event, projectId: string) => {
    try {
      parseArgs('db:getTasks', z.string(), projectId);
      const data = DatabaseService.getTasks(projectId);
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('db:saveTask', (_event, task) => {
    try {
      parseArgs('db:saveTask', taskInputSchema, task);
      const isNew = !task.id;
      const data = DatabaseService.saveTask(task);
      if (isNew) TelemetryService.capture('task_created');
      // Allocate per-task ports the first time the row is saved. setupTask
      // persists to SQLite (the only source of truth for what ports are
      // taken); the renderer's later agent-PTY spawn reads the env from
      // there. Skipped for in-place (non-worktree) tasks — they share the
      // project dir and shouldn't get re-allocated on every save.
      if (isNew && data.useWorktree) {
        try {
          WorkspacePortsRuntime.setupTask({ taskId: data.id, worktreePath: data.path });
          // Arm the watcher even if .dash/ doesn't exist yet — ensureWatching
          // keeps the entry and retries the fs.watch on every subsequent
          // call, so it auto-attaches as soon as the agent creates .dash/.
          // The watcher lives until db:deleteTask stops it.
          ensurePortsConfigWatch(data.id, data.path);
        } catch (err) {
          console.error('[dbIpc] setupTask ports allocation failed:', err);
        }
      }
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('db:deleteTask', async (_event, id: string) => {
    try {
      parseArgs('db:deleteTask', z.string(), id);
      // Forget the task's supervisor session first (transcript kept), while
      // the row still carries the job id.
      await removeTaskSession(id).catch((err) =>
        console.warn('[db:deleteTask] session removal failed:', err),
      );
      DatabaseService.deleteTask(id);
      // The worktree is gone (or about to be) — close the ports watcher,
      // drop any never-consumed initial prompt, and dismiss a lingering
      // ports-setup toast for this task.
      stopPortsConfigWatch(id);
      discardInitialPrompt(id);
      removeShellHistory(id);
      void getTuiHost().cancelForTask(id);
      TelemetryService.capture('task_deleted');
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle(
    'db:setTaskScripts',
    (_event, args: { id: string; setupScript: string | null; teardownScript: string | null }) => {
      try {
        parseArgs(
          'db:setTaskScripts',
          z.looseObject({
            id: z.string(),
            setupScript: z.string().nullable(),
            teardownScript: z.string().nullable(),
          }),
          args,
        );
        const data = DatabaseService.setTaskScripts(args.id, args.setupScript, args.teardownScript);
        return { success: true, data };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle('db:archiveTask', async (_event, id: string) => {
    try {
      parseArgs('db:archiveTask', z.string(), id);
      // An archived task's session sleeps (`claude stop`); restoring and
      // opening the task attaches, which wakes it.
      await stopTaskSession(id).catch((err) =>
        console.warn('[db:archiveTask] session stop failed:', err),
      );
      DatabaseService.archiveTask(id);
      TelemetryService.capture('task_archived');
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle(
    'db:reorderTasks',
    (_event, args: { projectId: string; orderedTaskIds: string[] }) => {
      try {
        parseArgs(
          'db:reorderTasks',
          z.looseObject({ projectId: z.string(), orderedTaskIds: z.array(z.string()) }),
          args,
        );
        DatabaseService.reorderTasks(args.projectId, args.orderedTaskIds);
        return { success: true };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle('db:restoreTask', (_event, id: string) => {
    try {
      parseArgs('db:restoreTask', z.string(), id);
      DatabaseService.restoreTask(id);
      TelemetryService.capture('task_restored');
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // ── Conversations ────────────────────────────────────────

  ipcMain.handle('db:getConversations', (_event, taskId: string) => {
    try {
      parseArgs('db:getConversations', z.string(), taskId);
      const data = DatabaseService.getConversations(taskId);
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('db:getOrCreateDefaultConversation', (_event, taskId: string) => {
    try {
      parseArgs('db:getOrCreateDefaultConversation', z.string(), taskId);
      const data = DatabaseService.getOrCreateDefaultConversation(taskId);
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
