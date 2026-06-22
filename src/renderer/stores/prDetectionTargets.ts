import type { Project, Task } from '../../shared/types';
import { isAdoRemote } from '../../shared/urls';

/** A task whose branch may have a PR worth fetching, plus how to fetch it. */
export interface PrDetectionTarget {
  taskId: string;
  branch: string;
  provider: 'github' | 'ado';
  cwd: string;
  remote: string | null;
  projectId: string;
}

/**
 * Which of a project's tasks should have their PR fetched, and via which
 * provider. Mirrors gitStore.detectPr's gating: a task on the project's default
 * branch (or with no branch) has no PR to show. Pure so it can be unit-tested
 * without touching IPC.
 */
export function prDetectionTargets(project: Project, tasks: Task[]): PrDetectionTarget[] {
  const defaultBranch = project.baseRef || project.gitBranch || 'main';
  const remote = project.gitRemote ?? null;
  const provider: 'github' | 'ado' = remote && isAdoRemote(remote) ? 'ado' : 'github';
  return tasks
    .filter((t) => t.branch && t.branch !== defaultBranch)
    .map((t) => ({
      taskId: t.id,
      branch: t.branch,
      provider,
      cwd: t.path || project.path,
      remote,
      projectId: project.id,
    }));
}
