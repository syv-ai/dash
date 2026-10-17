/**
 * Lowercase, replace runs of non-alphanumerics with a single hyphen, trim
 * leading/trailing hyphens, and cap at 50 characters.
 *
 * Shared across processes so a task's worktree directory name, its branch slug,
 * and service tab ids all derive identically. The on-disk worktree directory
 * depends on this exact shape — do not change it without a migration for
 * existing worktrees.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * A task name as a branch name: `slugify` per `/`-separated part, keeping the
 * slashes, so `feature/Add Thing` becomes `feature/add-thing` and fits branch
 * naming rules a CI may match on. Empty parts drop out. The worktree folder
 * stays flat (`slugify`); only the branch keeps the hierarchy.
 */
export function branchSlug(name: string): string {
  return name.split('/').map(slugify).filter(Boolean).join('/');
}
