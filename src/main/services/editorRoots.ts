import * as path from 'path';
import { DatabaseService } from './DatabaseService';
import { resolveMemoryDir } from './MemoryService';
import { taskScratchpadDir } from './ScratchpadService';

/**
 * The folders a task's editor may open besides its worktree (A10): Claude
 * Code's own folders for that task, the session's scratchpad and the
 * project's memory. The renderer names such a file by its absolute path
 * beside the worktree's `cwd`; main works these folders out from the tasks
 * at `cwd` and refuses any other. No task at `cwd`, none.
 */
export async function outsideRoots(cwd: string): Promise<string[]> {
  const tasks = DatabaseService.getTasksByPath(path.resolve(cwd));
  if (tasks.length === 0) return [];
  const projects = DatabaseService.getProjects();
  const roots = await Promise.all(
    tasks.map(async (task) => {
      const project = projects.find((p) => p.id === task.projectId);
      return [taskScratchpadDir(task.id), project ? await resolveMemoryDir(project.path) : null];
    }),
  );
  return [...new Set(roots.flat().filter((r): r is string => r !== null))];
}
