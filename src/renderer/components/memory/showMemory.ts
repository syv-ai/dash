import { selectTaskById, useProjects } from '../../stores/projectsStore';
import { useUi } from '../../stores/uiStore';
import { toast } from '../ui/toast';
import { memoryTaskOf } from './memoryView';

/**
 * Show a task's memory: select the task and have its sidebar open on Agent's
 * Memory pane (shown narrow if it was collapsed), which takes the ask once
 * it mounts (A12). The entry point for a task menu's "Memories".
 */
export function showTaskMemory(taskId: string): void {
  const task = selectTaskById(useProjects.getState(), taskId);
  if (!task) return;
  useProjects.getState().selectTask(task.projectId, task.id);
  useUi.getState().setMemoryRequestTaskId(task.id);
}

/**
 * Show a project's memory, from its menu or its new-memory count: in the
 * Agent tab of its active task, or of its first open one (`memoryTaskOf`).
 * Memory belongs to the repo, so any of its tasks shows the same; a project
 * with no open task says so instead.
 */
export function showProjectMemory(projectId: string): void {
  const { projects, tasksByProject, activeTaskId } = useProjects.getState();
  const task = memoryTaskOf(tasksByProject[projectId] ?? [], activeTaskId);
  if (task) {
    showTaskMemory(task.id);
    return;
  }
  const name = projects.find((p) => p.id === projectId)?.name ?? 'this project';
  toast.info(`Memory shows in a task's Agent tab. Start a task in ${name} to see it.`);
}
