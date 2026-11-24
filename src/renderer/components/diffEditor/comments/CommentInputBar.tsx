import { useState } from 'react';
import { Textarea } from '../../ui/Textarea';

interface Props {
  lineRange: { start: number; end: number } | null;
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
  submitLabel?: string;
}

/** Renders inside the WIP popover. Owns the textarea state and ⌘+Enter
 *  submit shortcut; the popover open/close is controlled by EditorPane. */
export function CommentInputBar({
  lineRange,
  initialText,
  onSubmit,
  onCancel,
  placeholder = 'Describe the change…',
  submitLabel = 'Add',
}: Props) {
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
      <div className="shrink-0 text-xs text-muted-fade-60 tabular-nums tracking-tight">
        {rangeLabel}
      </div>
      <Textarea
        autoFocus
        // Grows with its text, so a long comment needn't scroll in a little box.
        autoGrow={{ minRows: 3, maxRows: 20 }}
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
        placeholder={placeholder}
        variant="bare"
      />
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-fade-65">
          <kbd className="px-1.5 py-0.5 rounded-sm border border-foreground/10 bg-foreground/4 text-fg-fade-70">
            ⌘
          </kbd>
          <kbd className="px-1.5 py-0.5 rounded-sm border border-foreground/10 bg-foreground/4 text-fg-fade-70 ml-1">
            ↵
          </kbd>
          <span className="ml-1.5">to {submitLabel.toLowerCase()}</span>
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="ml-auto flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-sm font-medium tracking-tight bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {submitLabel}
        </button>
      </div>
    </>
  );
}
