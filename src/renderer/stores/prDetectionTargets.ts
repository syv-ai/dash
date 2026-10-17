import type { Project, PullRequestInfo, Task } from '../../shared/types';
import { isAdoRemote } from '../../shared/urls';

/** Where to look up a task's PRs, and through which provider. */
export interface PrDetectionTarget {
  taskId: string;
  provider: 'github' | 'ado';
  cwd: string;
  defaultBranch: string;
  remote: string | null;
  projectId: string;
}

/** The lookup for a checkout of `project` at `cwd`. */
export function prTargetFor(project: Project, cwd: string, taskId = ''): PrDetectionTarget {
  const remote = project.gitRemote ?? null;
  return {
    taskId,
    provider: remote && isAdoRemote(remote) ? 'ado' : 'github',
    cwd,
    defaultBranch: project.baseRef || project.gitBranch || 'main',
    remote,
    projectId: project.id,
  };
}

/**
 * One lookup per task. Main reads each checkout's live branch, so a session
 * that switched branches is covered and the default branch yields none; the
 * recorded `task.branch` (fixed at creation) is not consulted. Pure so it can
 * be unit-tested without touching IPC.
 */
export function prDetectionTargets(project: Project, tasks: Task[]): PrDetectionTarget[] {
  return tasks.map((t) => prTargetFor(project, t.path || project.path, t.id));
}

/** The target's PRs worth showing, or null when the lookup failed. */
export async function fetchPrsFor(t: PrDetectionTarget): Promise<PullRequestInfo[] | null> {
  try {
    const resp =
      t.provider === 'ado' && t.remote
        ? await window.electronAPI.adoGetPrsForCheckout({
            cwd: t.cwd,
            defaultBranch: t.defaultBranch,
            gitRemote: t.remote,
            projectId: t.projectId,
          })
        : await window.electronAPI.githubGetPrsForCheckout(t.cwd, t.defaultBranch);
    return resp.success ? (resp.data ?? []) : null;
  } catch {
    return null;
  }
}
