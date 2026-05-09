import React, { useState } from 'react';
import type { LinkedToolExecution } from '../../../../shared/sessionTypes';
import { extractResultText } from './extractResultText';
import { FilePathLink } from './FilePathLink';

const MAX_LINES = 30;

interface WriteViewerProps {
  exec: LinkedToolExecution;
}

export function WriteViewer({ exec }: WriteViewerProps) {
  const [showAll, setShowAll] = useState(false);
  const filePath = String(exec.toolCall.input.file_path ?? exec.toolCall.input.filePath ?? '');
  const fileContent = String(exec.toolCall.input.content ?? '');
  const lines = fileContent.split('\n');
  const truncated = !showAll && lines.length > MAX_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_LINES) : lines;
  const resultText = extractResultText(exec);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <FilePathLink filePath={filePath} />
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--git-added)/0.12)] text-[hsl(var(--git-added))] font-medium flex-shrink-0">
          Created
        </span>
      </div>

      {fileContent && (
        <div className="bg-surface-1 rounded border border-border/30 overflow-hidden">
          <pre className="text-[11px] font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap px-2.5 py-2 bg-[hsl(var(--git-added)/0.04)] max-h-96 overflow-y-auto">
            {displayLines.join('\n')}
          </pre>
          {truncated && (
            <button
              className="text-[10px] text-primary hover:text-primary/80 px-2.5 pb-2"
              onClick={() => setShowAll(true)}
            >
              Show all {lines.length} lines
            </button>
          )}
        </div>
      )}

      {resultText && <div className="text-[10px] text-muted-foreground/60">{resultText}</div>}

      {exec.result?.isError && (
        <div className="text-[10px] text-destructive font-medium">
          {resultText || 'Error creating file'}
        </div>
      )}
    </div>
  );
}
