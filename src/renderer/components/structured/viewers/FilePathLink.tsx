import React from 'react';
import { Tooltip } from '../../ui/Tooltip';

interface FilePathLinkProps {
  filePath: string;
  taskPath: string;
  className?: string;
}

/** U+200E LEFT-TO-RIGHT MARK — forces neutral chars (slashes, dots) to render
 *  LTR inside the dir="rtl" button. Do not delete; see render comment. */
const LRM = '‎';

/**
 * Render `filePath` shortened to "<task-parent>/<task-name>/<rel>" when it lives
 * inside the task worktree. Paths outside the task fall back to the absolute
 * form. The full absolute path is always passed to openInEditor.
 */
export function shortenPath(absPath: string, taskPath: string): string {
  if (!taskPath || !absPath.startsWith(taskPath)) return absPath;
  // Normalize separators in the rel portion so Windows paths don't render
  // as `worktrees/abc/src\main.ts`. The absolute path still uses native
  // separators for openInEditor.
  const rel = absPath
    .slice(taskPath.length)
    .replace(/^[/\\]/, '')
    .replace(/\\/g, '/');
  const segments = taskPath.split(/[/\\]/).filter(Boolean);
  const taskName = segments[segments.length - 1] ?? '';
  const parent = segments[segments.length - 2] ?? '';
  const prefix = parent ? `${parent}/${taskName}` : taskName;
  return rel ? `${prefix}/${rel}` : prefix;
}

export function FilePathLink({ filePath, taskPath, className = '' }: FilePathLinkProps) {
  if (!filePath) return null;
  const display = shortenPath(filePath, taskPath);
  return (
    <Tooltip content={filePath}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          window.electronAPI
            .openInEditor({ cwd: '', filePath })
            .then((res) => {
              if (!res.success) {
                console.warn('[FilePathLink] openInEditor failed:', res.error);
              }
            })
            .catch((err) => {
              console.warn('[FilePathLink] openInEditor error:', err);
            });
        }}
        // RTL container truncates from the start so the filename stays visible;
        // the LRM prefix keeps the path text rendering LTR. See `LRM` constant.
        dir="rtl"
        className={`text-[11px] font-mono text-primary/80 truncate hover:text-primary hover:underline underline-offset-2 cursor-pointer max-w-full ${className}`}
      >
        {LRM + display}
      </button>
    </Tooltip>
  );
}
