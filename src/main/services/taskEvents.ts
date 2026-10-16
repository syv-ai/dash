import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';

export interface TasksChangedEvent {
  projectId: string;
}

/**
 * "A project's tasks changed" (created, archived, restored, deleted), for
 * listeners in main (`taskEvents.on('tasks-changed', …)`) and the renderer
 * (`tasks:changed`), which reloads that project's task list. TaskService is the
 * only emitter, so a task created by the control API shows up in the sidebar
 * without anyone opening it.
 */
class TaskEvents extends EventEmitter {
  emitChanged(projectId: string): void {
    const event: TasksChangedEvent = { projectId };
    this.emit('tasks-changed', event);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send('tasks:changed', event);
      } catch (err) {
        console.warn('[taskEvents] broadcast failed', err);
      }
    }
  }
}

export const taskEvents = new TaskEvents();
