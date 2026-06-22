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
