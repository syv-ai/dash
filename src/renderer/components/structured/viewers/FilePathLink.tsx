import React from 'react';

interface FilePathLinkProps {
  filePath: string;
  className?: string;
}

export function FilePathLink({ filePath, className = '' }: FilePathLinkProps) {
  if (!filePath) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        window.electronAPI.openInEditor({ cwd: '', filePath });
      }}
      title={`Open ${filePath}`}
      className={`text-[11px] font-mono text-primary/80 truncate hover:text-primary hover:underline underline-offset-2 cursor-pointer text-left ${className}`}
    >
      {filePath}
    </button>
  );
}
