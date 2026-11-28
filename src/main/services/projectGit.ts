import { hasGit } from '../utils/gitPresence';
import { DatabaseService } from './DatabaseService';
import { GitService } from './GitService';
import { startGitPresenceWatches } from './gitPresenceWatch';
import { broadcastProjectsChanged } from './projectEvents';

/**
 * Re-read whether a project's folder is a git checkout and, when that
 * changed, store it (with the remote and branch a new repository has, none
 * without one) and tell the renderer, whose git views follow
 * `project.isGitRepo`.
 */
export async function redetectProjectGit(projectId: string): Promise<void> {
  const project = DatabaseService.getProjects().find((p) => p.id === projectId);
  if (!project) return;
  const isGitRepo = hasGit(project.path);
  if (isGitRepo === project.isGitRepo) return;
  const detected = isGitRepo ? await GitService.detectRepo(project.path) : null;
  DatabaseService.saveProject({
    ...project,
    isGitRepo,
    gitRemote: detected?.remote ?? null,
    gitBranch: detected?.branch ?? null,
  });
  broadcastProjectsChanged();
}

/** At startup: follow every project's git presence live (`gitPresenceWatch`). */
export function startProjectGitWatches(): void {
  startGitPresenceWatches(DatabaseService.getProjects(), (id) => {
    redetectProjectGit(id).catch((err) => console.error('[projectGit] redetect failed', err));
  });
}
