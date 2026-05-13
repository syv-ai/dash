import React, { useState } from 'react';
import type { LinkedToolExecution } from '../../../../shared/sessionTypes';
import { extractResultText } from './extractResultText';

const MAX_OUTPUT_LINES = 30;

interface BashViewerProps {
  exec: LinkedToolExecution;
}

export function BashViewer({ exec }: BashViewerProps) {
  const [showAll, setShowAll] = useState(false);
  const command = String(exec.toolCall.input.command ?? '');
  const description = String(exec.toolCall.input.description ?? '');
  const output = extractResultText(exec);
  const lines = output.split('\n');
  const truncated = !showAll && lines.length > MAX_OUTPUT_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_OUTPUT_LINES) : lines;

  return (
    <div className="space-y-2">
      {description && (
        <div className="text-[10px] text-muted-foreground/60 italic">{description}</div>
      )}
      <div className="bg-surface-1 rounded border border-border/30 px-2.5 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] text-green-500 font-mono">$</span>
          <pre className="text-[11px] font-mono text-foreground/90 whitespace-pre-wrap break-all">
            {command}
          </pre>
        </div>
      </div>
      {output && (
        <div className="bg-surface-1 rounded border border-border/30 px-2.5 py-2">
          <pre className="text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
            {displayLines.join('\n')}
          </pre>
          {truncated && (
            <button
              className="text-[10px] text-primary hover:text-primary/80 mt-1"
              onClick={() => setShowAll(true)}
            >
              Show all {lines.length} lines
            </button>
          )}
        </div>
      )}
      {exec.result?.isError && (
        <div className="text-[10px] text-destructive font-medium">Error</div>
      )}
    </div>
  );
}
