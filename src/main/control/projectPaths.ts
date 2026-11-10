import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Project } from '../../shared/types';

/*
 * Paths and the projects they belong to, for `--project` (cli.ts) and
 * `projects add` (capabilities/projects.ts). Node built-ins only.
 */

/** `p` with symlinks resolved, when it exists. */
export function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** A path as the caller typed it, made absolute: `~` is the home folder, a relative path is `cwd`'s. */
export function resolveFrom(cwd: string, ref: string): string {
  const expanded =
    ref === '~' || ref.startsWith('~/') ? path.join(os.homedir(), ref.slice(1)) : ref;
  return path.resolve(cwd, expanded);
}

/** The main checkout of the git repository `dir` is in (a worktree's too), or null. */
export function mainCheckout(dir: string): string | null {
  try {
    const common = execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    const abs = path.resolve(dir, common);
    return path.basename(abs) === '.git' ? path.dirname(abs) : null;
  } catch {
    return null;
  }
}

/**
 * The project an absolute path belongs to: the project's folder or one inside
 * it (the deepest project wins), or else a git worktree whose main checkout is
 * the project, wherever it is.
 */
export function projectAtPath(
  projects: Project[],
  absPath: string,
  checkoutOf: (dir: string) => string | null = mainCheckout,
): Project | undefined {
  const target = realPath(absPath);
  const roots = projects.map((p) => ({ p, root: realPath(p.path) }));
  const containing = roots
    .filter(({ root }) => target === root || target.startsWith(root + path.sep))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (containing) return containing.p;
  const main = checkoutOf(target);
  if (main === null) return undefined;
  const mainRoot = realPath(main);
  return roots.find(({ root }) => root === mainRoot)?.p;
}
