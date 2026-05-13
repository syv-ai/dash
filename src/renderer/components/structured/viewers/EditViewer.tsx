import React from 'react';
import type { LinkedToolExecution } from '../../../../shared/sessionTypes';
import { extractResultText } from './extractResultText';
import { FilePathLink } from './FilePathLink';

interface EditViewerProps {
  exec: LinkedToolExecution;
  taskPath: string;
}

export function EditViewer({ exec, taskPath }: EditViewerProps) {
  const filePath = String(exec.toolCall.input.file_path ?? exec.toolCall.input.filePath ?? '');
  const oldString = String(exec.toolCall.input.old_string ?? exec.toolCall.input.oldString ?? '');
  const newString = String(exec.toolCall.input.new_string ?? exec.toolCall.input.newString ?? '');

  const oldLines = oldString ? oldString.split('\n') : [];
  const newLines = newString ? newString.split('\n') : [];

  return (
    <div className="space-y-2 min-w-0">
      <FilePathLink filePath={filePath} taskPath={taskPath} className="block" />

      {(oldLines.length > 0 || newLines.length > 0) && (
        <div className="rounded border border-border/30 overflow-hidden bg-surface-1">
          <div className="font-mono text-[11px] leading-relaxed max-h-72 overflow-y-auto">
            {oldLines.map((line, i) => (
              <div
                key={`o-${i}`}
                className="diff-delete flex items-start text-[hsl(var(--git-deleted))]"
              >
                <span className="select-none w-5 flex-shrink-0 text-center opacity-60">-</span>
                <pre className="whitespace-pre-wrap break-all flex-1 pr-2 py-px">{line || ' '}</pre>
              </div>
            ))}
            {newLines.map((line, i) => (
              <div
                key={`n-${i}`}
                className="diff-add flex items-start text-[hsl(var(--git-added))]"
              >
                <span className="select-none w-5 flex-shrink-0 text-center opacity-60">+</span>
                <pre className="whitespace-pre-wrap break-all flex-1 pr-2 py-px">{line || ' '}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {exec.result?.isError && (
        <div className="text-[10px] text-destructive font-medium">
          {extractResultText(exec) || 'Error editing file'}
        </div>
      )}
    </div>
  );
}
