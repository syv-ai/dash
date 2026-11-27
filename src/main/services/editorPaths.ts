import { realpathSync } from 'fs';
import path from 'path';

/*
 * Where an editor path may lead (A10): inside a task's worktree, or inside one
 * of the folders outside it a task's editor may open. Pure (the disk only),
 * shared by the editor's IPC and the control API's `show`.
 */

export function safeRealpath(p: string): string {
  return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
}

function resolveTargetReal(target: string): string {
  try {
    return safeRealpath(target);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  let ancestor = path.dirname(target);
  let tail = path.basename(target);
  for (;;) {
    try {
      return path.join(safeRealpath(ancestor), tail);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
      tail = path.join(path.basename(ancestor), tail);
      const next = path.dirname(ancestor);
      if (next === ancestor) return target;
      ancestor = next;
    }
  }
}

/** The path is inside cwd, but a symlink on the way leads out of it. */
class SymlinkEscapeError extends Error {
  constructor(
    /** The path as named, inside cwd. */
    readonly target: string,
    real: string,
  ) {
    super(`Resolved path via symlink escapes cwd: ${real}`);
  }
}

export function resolveInsideCwd(cwd: string, filePath: string): string {
  if (filePath.includes('\0')) {
    throw new Error('Invalid filePath: contains null byte');
  }
  const cwdAbs = path.resolve(cwd);
  const target = path.isAbsolute(filePath) ? filePath : path.resolve(cwdAbs, filePath);
  const rel = path.relative(cwdAbs, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Resolved path escapes cwd: ${target}`);
  }
  let cwdReal: string;
  try {
    cwdReal = safeRealpath(cwdAbs);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
    cwdReal = cwdAbs;
  }
  const real = resolveTargetReal(target);
  const realRel = path.relative(cwdReal, real);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new SymlinkEscapeError(target, real);
  }
  return real;
}

/**
 * For reading only: like `resolveInsideCwd`, but a symlink inside cwd may lead
 * out of it (a worktree's `node_modules` linked to the main checkout's). The
 * path as named must still be inside cwd. Writes keep the stricter rule.
 */
export function resolveReadableInsideCwd(cwd: string, filePath: string): string {
  try {
    return resolveInsideCwd(cwd, filePath);
  } catch (err) {
    if (err instanceof SymlinkEscapeError) return err.target;
    throw err;
  }
}

/** Whether `p` names something strictly inside `dir`, as written (no links followed). */
function namedInside(dir: string, p: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(dir, p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Where an editor file lives, checked (A10): in `cwd`, the task's worktree,
 * where git applies; or, named by its absolute path, in one of `outside`, the
 * task's own Claude Code folders (`outsideRoots`), as a plain file. The path
 * as named and its real path must both stay in that one folder, or this
 * throws. A read in the worktree may follow a symlink out of it
 * (`resolveReadableInsideCwd`); an outside folder's never may.
 */
export function resolveEditorPath(
  cwd: string,
  filePath: string,
  outside: readonly string[],
  access: 'read' | 'write',
): { abs: string; plain: boolean } {
  if (!path.isAbsolute(filePath) || namedInside(cwd, filePath)) {
    const abs =
      access === 'read' ? resolveReadableInsideCwd(cwd, filePath) : resolveInsideCwd(cwd, filePath);
    return { abs, plain: false };
  }
  const root = outside.find((dir) => namedInside(dir, filePath));
  if (!root) throw new Error(`Resolved path escapes cwd: ${filePath}`);
  return { abs: resolveInsideCwd(root, filePath), plain: true };
}
