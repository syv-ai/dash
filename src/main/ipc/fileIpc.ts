import { realpathSync } from 'fs';
import path from 'path';

function safeRealpath(p: string): string {
  return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
}

/**
 * Realpath the target if it exists; otherwise walk up to the deepest existing
 * ancestor, realpath that, and reattach the missing tail. This lets us safely
 * validate paths whose target (or whose parent dirs) don't exist yet, while
 * still catching any symlink in the chain that points outside.
 */
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

/**
 * Resolve a renderer-supplied filePath to an absolute path strictly inside the
 * supplied cwd (the task's worktree). Throws on any escape: parent traversal,
 * absolute paths outside cwd, null bytes, or symlinks pointing outside.
 *
 * Returns the realpath-resolved absolute path so symlinks inside the worktree
 * are followed (matching git's view), but symlinks pointing outside are caught.
 */
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
  // Realpath both sides so /tmp vs /private/tmp on macOS doesn't trip the check.
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
    throw new Error(`Resolved path via symlink escapes cwd: ${real}`);
  }
  return real;
}

/** NUL-byte heuristic over a sample buffer. Mirrors git's binary check. */
export function isBinaryBuffer(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Map common extensions to Monaco language ids. '' falls back to plain text. */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    lua: 'lua',
  };
  return map[ext] || '';
}
