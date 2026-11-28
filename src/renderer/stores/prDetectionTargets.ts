import type { Project, PullRequestInfo, Task } from '../../shared/types';

/** Where to look up a task's PRs; main picks the forge from the project. */
export interface PrDetectionTarget {
  taskId: string;
  cwd: string;
  defaultBranch: string;
  projectId: string;
}

/** The lookup for a checkout of `project` at `cwd`. */
export function prTargetFor(project: Project, cwd: string, taskId = ''): PrDetectionTarget {
  return {
    taskId,
    cwd,
    defaultBranch: project.baseRef || project.gitBranch || 'main',
    projectId: project.id,
  };
}

/**
 * One lookup per task. Main reads each checkout's live branch, so a session
 * that switched branches is covered and the default branch yields none; the
 * recorded `task.branch` (fixed at creation) is not consulted; none for a
 * plain folder's tasks. Pure so it can
 * be unit-tested without touching IPC.
 */
export function prDetectionTargets(project: Project, tasks: Task[]): PrDetectionTarget[] {
  // A plain folder has no branches, so no PRs.
  if (!project.isGitRepo) return [];
  return tasks.map((t) => prTargetFor(project, t.path || project.path, t.id));
}

/** A branch's PRs: the ones standing for it now, and all of them, newest first. */
export interface BranchPrs {
  current: PullRequestInfo[];
  all: PullRequestInfo[];
}

/** The target's PRs, or null when the lookup failed. */
export async function fetchPrsFor(t: PrDetectionTarget): Promise<BranchPrs | null> {
  try {
    const resp = await window.electronAPI.prForCheckout({
      projectId: t.projectId,
      cwd: t.cwd,
      defaultBranch: t.defaultBranch,
    });
    if (!resp.success) return null;
    const all = resp.data ?? [];
    return { current: all.filter((p) => p.current), all };
  } catch {
    return null;
  }
}
