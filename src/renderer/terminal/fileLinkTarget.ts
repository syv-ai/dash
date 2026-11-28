import type { TextRange } from '../stores/editorTabsStore';

/**
 * A file link's path as an absolute POSIX path, `.` and `..` resolved against
 * the terminal's cwd; null when neither is POSIX-absolute (a Windows path),
 * which the caller hands to the external editor instead.
 */
export function resolveLinkPath(cwd: string, filePath: string): string | null {
  const joined = filePath.startsWith('/') ? filePath : `${cwd}/${filePath}`;
  if (!joined.startsWith('/')) return null;
  const out: string[] = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`;
}

/** The caret a `path:line:col` link lands on; none without a line. */
export function linkRange(line?: number, col?: number): TextRange | undefined {
  if (line == null) return undefined;
  const c = col ?? 1;
  return { startLineNumber: line, startColumn: c, endLineNumber: line, endColumn: c };
}
