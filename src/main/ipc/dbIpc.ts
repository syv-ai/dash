import { ipcMain } from 'electron';
import { DatabaseService } from '../services/DatabaseService';
import { TelemetryService } from '../services/TelemetryService';
import { WorkspacePortsRuntime } from '../services/WorkspacePortsRuntime';
import {
  ensureWatching as ensurePortsConfigWatch,
  stop as stopPortsConfigWatch,
} from '../services/PortsConfigWatcher';
import { discardInitialPrompt } from '../services/ptyManager';

export function registerDbIpc(): void {
  // ── Projects ─────────────────────────────────────────────

  ipcMain.handle('db:getProjects', () => {
    try {
      const data = DatabaseService.getProjects();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('db:saveProject', (_event, project) => {
    try {
      const isNew = !project.id;
      const data = DatabaseService.saveProject(project);
      if (isNew) TelemetryService.capture('project_added');
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('db:deleteProject', (_event, id: string) => {
    try {
      DatabaseService.deleteProject(id);
      TelemetryService.capture('project_deleted');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── Tasks ────────────────────────────────────────────────

  ipcMain.handle('db:getTasks', (_event, projectId: string) => {
    try {
      const data = DatabaseService.getTasks(projectId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('db:saveTask', (_event, task) => {
    try {
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
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('db:deleteTask', (_event, id: string) => {
    try {
      DatabaseService.deleteTask(id);
      // The worktree is gone (or about to be) — close the ports watcher
      // and drop any never-consumed initial prompt.
      stopPortsConfigWatch(id);
      discardInitialPrompt(id);
      TelemetryService.capture('task_deleted');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('db:archiveTask', (_event, id: string) => {
    try {
      DatabaseService.archiveTask(id);
      TelemetryService.capture('task_archived');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'db:reorderTasks',
    (_event, args: { projectId: string; orderedTaskIds: string[] }) => {
      try {
        DatabaseService.reorderTasks(args.projectId, args.orderedTaskIds);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('db:restoreTask', (_event, id: string) => {
    try {
      DatabaseService.restoreTask(id);
      TelemetryService.capture('task_restored');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── Conversations ────────────────────────────────────────

  ipcMain.handle('db:getConversations', (_event, taskId: string) => {
    try {
      const data = DatabaseService.getConversations(taskId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('db:getOrCreateDefaultConversation', (_event, taskId: string) => {
    try {
      const data = DatabaseService.getOrCreateDefaultConversation(taskId);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
