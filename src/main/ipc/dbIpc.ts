import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { projectInputSchema, taskInputSchema } from './schemas';
import { DatabaseService } from '../services/DatabaseService';
import { TelemetryService } from '../services/TelemetryService';
import { stopTaskSession } from '../services/ptyManager';
import { removeTaskMcpConfig } from '../control/mcpConfig';

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
      // The task rows go with the project (cascade), not through
      // TaskService.delete, so their `--mcp-config` files are removed here.
      for (const task of DatabaseService.getTasks(id)) {
        try {
          removeTaskMcpConfig(task.id);
        } catch (err) {
          console.warn(`[db:deleteProject] mcp-config removal failed for ${task.id}:`, err);
        }
      }
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
      // Updates only: a new task goes through task:create (TaskService), which
      // owns the creation side effects (ports, telemetry, first prompt).
      if (!task.id) throw new Error('db:saveTask updates an existing task; use task:create');
      const data = DatabaseService.saveTask(task);
      return { success: true, data };
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
