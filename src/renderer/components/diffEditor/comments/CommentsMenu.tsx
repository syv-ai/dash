import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import type { DiffComment } from './types';

interface Props {
  commentsByFile: Record<string, DiffComment[]>;
  currentFilePath: string;
  /** Returns the current model's live range for the given comment id, or
   *  null if the comment isn't in the current file. Lets the dropdown show
   *  up-to-the-second line numbers for the open file (which may have
   *  shifted due to typing) while non-current files fall back to stored. */
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onSend: () => void;
}

export function CommentsMenu({
  commentsByFile,
  currentFilePath,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSend,
}: Props) {
  const [open, setOpen] = useState(false);

  // Stable order: current file first, then the rest alphabetically.
  const groups = Object.entries(commentsByFile)
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => {
      if (a === currentFilePath) return -1;
      if (b === currentFilePath) return 1;
      return a.localeCompare(b);
    });
  const totalCount = groups.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all duration-150">
          <span>
            {totalCount} comment{totalCount !== 1 ? 's' : ''}
          </span>
          <ChevronDown size={12} strokeWidth={2} className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-[420px] max-h-[460px] flex flex-col p-0"
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
          {groups.map(([path, list]) => (
            <div key={path} className="mb-1.5 last:mb-0">
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono flex items-center gap-1.5">
                <span className="truncate">{path}</span>
                {path === currentFilePath && (
                  <span className="text-[9px] text-primary/80 normal-case tracking-normal flex-shrink-0">
                    · current
                  </span>
                )}
              </div>
              {list.map((c) => {
                const live = path === currentFilePath ? getLiveRangeForCurrent(c.id) : null;
                const start = live?.start ?? c.startLine;
                const end = live?.end ?? c.endLine;
                const lineLabel = start === end ? `L${start}` : `L${start}–${end}`;
                return (
                  <div
                    key={c.id}
                    className="group relative flex flex-col rounded-md hover:bg-[hsl(var(--surface-2)/0.6)] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onNavigate(path, c.id);
                      }}
                      title="Jump to this comment"
                      className="flex flex-col gap-1 px-2.5 py-2 text-left w-full rounded-md"
                    >
                      <span className="font-mono text-[10.5px] text-muted-foreground/70 truncate">
                        {lineLabel}
                      </span>
                      <span className="text-[12px] text-foreground/85 leading-relaxed whitespace-pre-wrap">
                        {c.text}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(path, c.id)}
                      aria-label="Remove comment"
                      className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition"
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/40">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSend();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition"
          >
            Add {totalCount} comment{totalCount !== 1 ? 's' : ''} to prompt
          </button>
        </div>
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}
