import React, { useState } from 'react';
import type { LinkedToolExecution } from '../../../../shared/sessionTypes';

function extractResultText(exec: LinkedToolExecution): string {
  if (!exec.result) return '';
  const content = exec.result.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => (b as { type: string }).type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

interface DefaultViewerProps {
  exec: LinkedToolExecution;
}

export function DefaultViewer({ exec }: DefaultViewerProps) {
  const [showInput, setShowInput] = useState(false);
  const resultText = extractResultText(exec);
  const inputStr = JSON.stringify(exec.toolCall.input, null, 2);

  return (
    <div className="space-y-2">
      <div>
        <button
          className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          onClick={() => setShowInput(!showInput)}
        >
          {showInput ? 'Hide' : 'Show'} input
        </button>
        {showInput && (
          <div className="bg-surface-1 rounded border border-border/30 px-2.5 py-2 mt-1">
            <pre className="text-[11px] font-mono text-foreground/70 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
              {inputStr}
            </pre>
          </div>
        )}
      </div>

      {resultText && (
        <div className="bg-surface-1 rounded border border-border/30 px-2.5 py-2">
          <div className="text-[10px] text-muted-foreground/60 mb-1">Output</div>
          <pre className="text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
            {resultText.slice(0, 3000)}
            {resultText.length > 3000 && '...'}
          </pre>
        </div>
      )}

      {exec.result?.isError && (
        <div className="text-[10px] text-destructive font-medium">Error</div>
      )}
    </div>
  );
}
