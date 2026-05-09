import React, { useState } from 'react';
import type { LinkedToolExecution } from '../../../../shared/sessionTypes';
import { extractResultText } from './extractResultText';
import { FilePathLink } from './FilePathLink';

const MAX_LINES = 50;

interface ReadViewerProps {
  exec: LinkedToolExecution;
}

export function ReadViewer({ exec }: ReadViewerProps) {
  const [showAll, setShowAll] = useState(false);
  const filePath = String(exec.toolCall.input.file_path ?? exec.toolCall.input.filePath ?? '');
  const offset = exec.toolCall.input.offset as number | undefined;
  const limit = exec.toolCall.input.limit as number | undefined;
  const output = extractResultText(exec);
  const lines = output.split('\n');
  const truncated = !showAll && lines.length > MAX_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_LINES) : lines;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <FilePathLink filePath={filePath} />
        {offset != null && (
          <span className="text-[10px] text-muted-foreground/50">
            L{offset}
            {limit ? `-${offset + limit}` : ''}
          </span>
        )}
      </div>
      {output && (
        <div className="bg-surface-1 rounded border border-border/30 overflow-hidden">
          <pre className="text-[11px] font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap px-2.5 py-2 max-h-96 overflow-y-auto">
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
      {exec.result?.isError && (
        <div className="text-[10px] text-destructive font-medium">
          {extractResultText(exec) || 'Error reading file'}
        </div>
      )}
    </div>
  );
}
