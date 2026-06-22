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
      <div className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/60 tabular-nums tracking-tight">
        {rangeLabel}
      </div>
      <textarea
        autoFocus
        // Marker the surrounding <Modal>'s window-capture Esc handler
        // looks for — when focus is in here, Esc cancels the draft instead
        // of closing the modal.
        data-diff-comment-input="true"
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
        className="flex-1 min-h-0 w-full text-[12.5px] leading-relaxed tracking-[-0.005em] bg-transparent px-0 py-0 resize-none placeholder:text-muted-foreground/35 focus:outline-none"
      />
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10.5px] text-muted-foreground/65 font-mono">
          <kbd className="px-1.5 py-0.5 rounded-[5px] border border-foreground/10 bg-foreground/[0.04] text-foreground/70">
            ⌘
          </kbd>
          <kbd className="px-1.5 py-0.5 rounded-[5px] border border-foreground/10 bg-foreground/[0.04] text-foreground/70 ml-1">
            ↵
          </kbd>
          <span className="ml-1.5">to add</span>
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="ml-auto flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[11.5px] font-medium tracking-tight bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          Add
        </button>
      </div>
    </>
  );
}
