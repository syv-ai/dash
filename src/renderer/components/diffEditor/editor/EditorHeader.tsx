import { WrapText, X } from 'lucide-react';
import type { EditorView } from '../types';

interface Props {
  filePath: string;
  view: EditorView;
  wordWrap: boolean;
  onToggleWordWrap(): void;
  onClose(): void;
  backgroundColor: string;
}

export function EditorHeader({
  filePath,
  view,
  wordWrap,
  onToggleWordWrap,
  onClose,
  backgroundColor,
}: Props) {
  const isCommit = view.kind === 'commit';
  return (
    <div
      className="flex items-center justify-between px-3 h-9 border-b border-white/[0.06] flex-shrink-0"
      style={{ background: backgroundColor }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[13px] font-medium text-foreground truncate">{filePath}</span>
        {isCommit && (
          <span className="text-[11px] tabular-nums text-muted-foreground/50 font-mono">
            {view.hash.slice(0, 7)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleWordWrap}
          title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          className={`p-1.5 rounded-md transition-colors ${
            wordWrap
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/60'
          }`}
        >
          <WrapText size={14} strokeWidth={1.8} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
