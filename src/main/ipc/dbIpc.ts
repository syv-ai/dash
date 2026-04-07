import { ipcMain } from 'electron';
import { DatabaseService } from '../services/DatabaseService';
import { TelemetryService } from '../services/TelemetryService';

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
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('db:deleteTask', (_event, id: string) => {
    try {
      DatabaseService.deleteTask(id);
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
