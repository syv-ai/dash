import { EventEmitter } from 'events';
import { broadcast } from '../utils/broadcast';

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
    broadcast('tasks:changed', event);
  }

  /** A task was created (`task-created`, its id): main only, for analytics. */
  emitCreated(taskId: string): void {
    this.emit('task-created', taskId);
  }
}

export const taskEvents = new TaskEvents();
