import React from 'react';
import type { LinkedToolExecution } from '../../../../shared/sessionTypes';
import { extractResultText } from './extractResultText';

interface EditViewerProps {
  exec: LinkedToolExecution;
}

export function EditViewer({ exec }: EditViewerProps) {
  const filePath = String(exec.toolCall.input.file_path ?? exec.toolCall.input.filePath ?? '');
  const oldString = String(exec.toolCall.input.old_string ?? exec.toolCall.input.oldString ?? '');
  const newString = String(exec.toolCall.input.new_string ?? exec.toolCall.input.newString ?? '');
  const resultText = extractResultText(exec);

  return (
    <div className="space-y-2">
      <span className="text-[11px] font-mono text-primary/80 truncate block">{filePath}</span>

      {oldString && (
        <div className="bg-surface-1 rounded border border-border/30 overflow-hidden">
          <div className="px-2.5 py-1 border-b border-border/20 text-[10px] text-muted-foreground/60 font-medium">
            Removed
          </div>
          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap px-2.5 py-2 bg-red-500/5 text-red-400/90 max-h-48 overflow-y-auto">
            {oldString}
          </pre>
        </div>
      )}

      {newString && (
        <div className="bg-surface-1 rounded border border-border/30 overflow-hidden">
          <div className="px-2.5 py-1 border-b border-border/20 text-[10px] text-muted-foreground/60 font-medium">
            Added
          </div>
          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap px-2.5 py-2 bg-green-500/5 text-green-400/90 max-h-48 overflow-y-auto">
            {newString}
          </pre>
        </div>
      )}

      {resultText && <div className="text-[10px] text-muted-foreground/60">{resultText}</div>}

      {exec.result?.isError && (
        <div className="text-[10px] text-destructive font-medium">
          {resultText || 'Error editing file'}
        </div>
      )}
    </div>
  );
}
