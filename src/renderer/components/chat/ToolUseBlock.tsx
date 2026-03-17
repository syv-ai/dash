import React, { useState } from 'react';
import { ChevronRight, Wrench, AlertCircle } from 'lucide-react';
import type { ChatContentBlock } from '../../../shared/types';

interface ToolUseBlockProps {
  block: ChatContentBlock & { type: 'tool_use' };
  result?: (ChatContentBlock & { type: 'tool_result' }) | null;
}

export function ToolUseBlock({ block, result }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1.5 rounded-md border border-border/60 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
        style={{ background: 'hsl(var(--surface-1))' }}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <Wrench size={12} strokeWidth={1.8} className="text-muted-foreground" />
        <span className="text-[12px] font-mono font-medium text-foreground/80">{block.name}</span>
        {result?.is_error && (
          <AlertCircle size={12} strokeWidth={2} className="text-destructive ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/40">
          {/* Input */}
          <div className="px-3 py-2" style={{ background: 'hsl(var(--surface-0))' }}>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Input
            </div>
            <pre className="text-[11px] font-mono text-foreground/70 whitespace-pre-wrap break-all overflow-x-auto max-h-[200px] overflow-y-auto">
              {formatJson(block.input)}
            </pre>
          </div>

          {/* Result */}
          {result && (
            <div
              className="px-3 py-2 border-t border-border/40"
              style={{ background: 'hsl(var(--surface-0))' }}
            >
              <div
                className={`text-[10px] font-medium uppercase tracking-wide mb-1 ${
                  result.is_error ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {result.is_error ? 'Error' : 'Output'}
              </div>
              <pre
                className={`text-[11px] font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[200px] overflow-y-auto ${
                  result.is_error ? 'text-destructive/80' : 'text-foreground/70'
                }`}
              >
                {result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}
