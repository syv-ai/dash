import { useState } from 'react';

interface Props {
  lineRange: { start: number; end: number } | null;
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

/** Renders inside the WIP popover. Owns the textarea state and ⌘+Enter
 *  submit shortcut; the popover open/close is controlled by EditorPane. */
export function CommentInputBar({ lineRange, initialText, onSubmit, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const submit = () => {
    if (text.trim()) onSubmit(text.trim());
  };
  const rangeLabel = lineRange
    ? lineRange.start === lineRange.end
      ? `Line ${lineRange.start}`
      : `Lines ${lineRange.start}–${lineRange.end}`
    : '';
  return (
    <>
      <div className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
        {rangeLabel}
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Stop ALL keys (incl. Escape) from bubbling to the surrounding
          // Modal — the popover handles its own dismiss via onCancel.
          e.stopPropagation();
          if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Describe the change…"
        className="flex-1 min-h-0 w-full text-[12.5px] leading-relaxed bg-transparent px-0 py-0 resize-none placeholder:text-muted-foreground/40 focus:outline-none"
      />
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10.5px] text-muted-foreground/70 font-mono">
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-foreground/5 text-foreground/70">
            ⌘
          </kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-foreground/5 text-foreground/70 ml-1">
            ↵
          </kbd>
          <span className="ml-1.5">to add</span>
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="ml-auto flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[11.5px] font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </>
  );
}
