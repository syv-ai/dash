import React from 'react';
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

interface TaskViewerProps {
  exec: LinkedToolExecution;
}

export function TaskViewer({ exec }: TaskViewerProps) {
  const description = String(exec.toolCall.input.description ?? exec.toolCall.input.prompt ?? '');
  const subagentType = String(
    exec.toolCall.input.subagent_type ?? exec.toolCall.input.subagentType ?? '',
  );
  const resultText = extractResultText(exec);

  return (
    <div className="space-y-2">
      {subagentType && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
          {subagentType}
        </span>
      )}

      {description && (
        <div className="text-[12px] text-foreground/80 leading-relaxed">{description}</div>
      )}

      {resultText && (
        <div className="bg-surface-1 rounded border border-border/30 px-2.5 py-2">
          <pre className="text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
            {resultText.slice(0, 2000)}
            {resultText.length > 2000 && '...'}
          </pre>
        </div>
      )}

      {exec.result?.isError && (
        <div className="text-[10px] text-destructive font-medium">Agent error</div>
      )}
    </div>
  );
}
