import { existsSync } from 'fs';
import * as path from 'path';

/**
 * Whether `dir` is a git checkout: a repository's root or a linked worktree
 * (`.git` a folder, or a file pointing at the repository). The one test of
 * whether a project is a git project (`projects.is_git_repo`); a folder
 * inside a repository but without its own `.git` is a plain folder to Dash.
 * A stat, no git spawned.
 */
export function hasGit(dir: string): boolean {
  return existsSync(path.join(dir, '.git'));
}

/**
 * Whether git run in `dir` would find a repository: `dir` or a folder above
 * it holds `.git`. Callers check it before spawning git, so a plain folder
 * costs a few stats instead of a git process that fails. (Git's own
 * discovery also honours GIT_DIR and GIT_CEILING_DIRECTORIES, which Dash
 * doesn't set.)
 */
export function withinGitRepo(dir: string): boolean {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (hasGit(d)) return true;
    if (path.dirname(d) === d) return false;
  }
}

/** Git was asked about a folder that holds no repository; nothing was spawned. */
export class NotAGitRepoError extends Error {
  constructor(readonly cwd: string) {
    super(`Not a git repository: ${cwd}`);
    this.name = 'NotAGitRepoError';
  }
}
