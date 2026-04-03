import React, { useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';

interface ThinkingBlockProps {
  text: string;
  defaultCollapsed?: boolean;
}

export function ThinkingBlock({ text, defaultCollapsed = true }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const preview = text.slice(0, 80).replace(/\n/g, ' ');

  return (
    <div className="bg-surface-1 rounded-lg border border-border/40">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2/50 transition-colors rounded-lg"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`text-muted-foreground/60 transition-transform flex-shrink-0 ${collapsed ? '' : 'rotate-90'}`}
        />
        <Brain size={13} strokeWidth={1.8} className="text-muted-foreground/60 flex-shrink-0" />
        <span className="text-[11px] font-medium text-muted-foreground">Thinking</span>
        {collapsed && (
          <span className="text-[11px] text-muted-foreground/40 truncate">{preview}...</span>
        )}
      </button>
      {!collapsed && (
        <div className="px-3 pb-3 max-h-96 overflow-y-auto">
          <pre className="text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap font-mono">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
