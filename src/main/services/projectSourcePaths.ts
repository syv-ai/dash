import { statSync } from 'fs';
import os from 'os';
import path from 'path';
import type { PathFacts } from '@shared/pathFacts';
import type { Project } from '@shared/types';
import { mainCheckout, projectAtPath, realPath } from '../control/projectPaths';
import { hasGit } from '../utils/gitPresence';

/**
 * A path from the New Project dialog, made absolute: `~` is the home folder.
 * Anything else relative is refused; the dialog has no working directory.
 */
export function expandUserPath(input: string, home = os.homedir()): string {
  const s = input.trim();
  const expanded = s === '~' || s.startsWith('~/') ? path.join(home, s.slice(1)) : s;
  if (!path.isAbsolute(expanded)) throw new Error(`Not a full path: ${input}`);
  return path.resolve(expanded);
}

function statOrNull(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

/**
 * What a typed path is on disk, and whether it already belongs to a project
 * (the same rule as `dashctl projects add`): the facts `classifySource` needs.
 */
export function inspectPath(
  input: string,
  projects: Project[],
  opts: { home?: string; checkoutOf?: (dir: string) => string | null } = {},
): PathFacts {
  const trimmed = input.trim();
  const abs = expandUserPath(trimmed, opts.home);
  const stat = statOrNull(abs);
  const isDirectory = stat?.isDirectory() ?? false;
  const owner = isDirectory
    ? projectAtPath(projects, abs, opts.checkoutOf ?? mainCheckout)
    : undefined;
  let project: PathFacts['project'] = null;
  if (owner) {
    const root = realPath(owner.path);
    const target = realPath(abs);
    project = {
      id: owner.id,
      name: owner.name,
      relation:
        root === target ? 'same' : target.startsWith(root + path.sep) ? 'inside' : 'worktree',
      archived: owner.archivedAt != null,
    };
  }
  return {
    input: trimmed,
    path: abs,
    exists: stat !== null,
    isDirectory,
    isGitRepo: isDirectory && hasGit(abs),
    parentExists: statOrNull(path.dirname(abs))?.isDirectory() ?? false,
    project,
  };
}
