import React from 'react';

interface FilePathLinkProps {
  filePath: string;
  taskPath: string;
  className?: string;
}

/**
 * Render `filePath` shortened to "<task-parent>/<task-name>/<rel>" when it lives
 * inside the task worktree. Paths outside the task fall back to the absolute
 * form. The full absolute path is always passed to openInEditor.
 */
function shortenPath(absPath: string, taskPath: string): string {
  if (!taskPath || !absPath.startsWith(taskPath)) return absPath;
  const rel = absPath.slice(taskPath.length).replace(/^[/\\]/, '');
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
      title={filePath}
      // RTL container with LTR content keeps the path readable but truncates from the
      // start, so the filename (the part users care about) is always visible. The
      // U+200E LRM prefix forces neutral chars (slashes, dots) to render LTR.
      dir="rtl"
      className={`text-[11px] font-mono text-primary/80 truncate hover:text-primary hover:underline underline-offset-2 cursor-pointer max-w-full ${className}`}
    >
      {'‎' + display}
    </button>
  );
}
