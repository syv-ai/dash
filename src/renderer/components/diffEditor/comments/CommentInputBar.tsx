import { useState } from 'react';
import { Bot, MessageSquare, Send } from 'lucide-react';
import type { DiffCommentKind } from '../../../../shared/types';
import { Button } from '../../ui/Button';
import { Kbd } from '../../ui/Kbd';
import { Segmented } from '../../ui/Segmented';
import { Textarea } from '../../ui/Textarea';
import { otherKind } from '../prReview/prViewPolicy';

/** A fresh draft's kind and the switch that picks it. */
export interface ComposerKind {
  value: DiffCommentKind;
  /** Pick the kind; null where only notes can be written (no pull request). */
  onChange: ((kind: DiffCommentKind) => void) | null;
}

interface Props {
  lineRange: { start: number; end: number } | null;
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
  submitLabel?: string;
  /** Show the Note to agent | Comment for author switch (fresh drafts only). */
  kind?: ComposerKind;
  /** Save a note and send it to the agent at once (button and ⌘⇧↵). */
  onSendNow?: (text: string) => void;
}

/** The composer: a growing textarea, ⌘↵ to submit; with `kind`, the
 *  note/comment switch (⌘⇧N flips it); with `onSendNow`, Send now for a note. */
export function CommentInputBar({
  lineRange,
  initialText,
  onSubmit,
  onCancel,
  placeholder = 'Describe the change…',
  submitLabel = 'Add',
  kind,
  onSendNow,
}: Props) {
  const [text, setText] = useState(initialText);
  const trimmed = text.trim();
  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };
  const sendNow = onSendNow && (kind?.value ?? 'note') === 'note' ? onSendNow : null;
  const rangeLabel = lineRange
    ? lineRange.start === lineRange.end
      ? `Line ${lineRange.start}`
      : `Lines ${lineRange.start}–${lineRange.end}`
    : '';
  const pickKind = kind?.onChange ?? null;
  return (
    <>
      {(rangeLabel || kind) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
          {kind && (
            <Segmented
              size="sm"
              fullWidth={false}
              aria-label="What this is"
              value={kind.value}
              onChange={(k) => pickKind?.(k)}
              options={[
                {
                  value: 'note',
                  label: 'Note to agent',
                  icon: <Bot size={14} strokeWidth={1.8} />,
                },
                {
                  value: 'comment',
                  label: 'Comment for author',
                  icon: <MessageSquare size={14} strokeWidth={1.8} />,
                  disabled: !pickKind,
                  title: pickKind ? undefined : 'Comments need a pull request',
                },
              ]}
            />
          )}
          <span className="type-caption ml-auto truncate tabular-nums">{rangeLabel}</span>
        </div>
      )}
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
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.shiftKey && e.code === 'KeyN') {
            e.preventDefault();
            if (kind && pickKind) pickKind(otherKind(kind.value));
            return;
          }
          if (mod && e.key === 'Enter') {
            e.preventDefault();
            if (!e.shiftKey) submit();
            else if (sendNow && trimmed) sendNow(trimmed);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        variant="bare"
      />
      <div className="flex shrink-0 items-center gap-2">
        <span className="type-caption flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
          <span className="ml-0.5">to {submitLabel.toLowerCase()}</span>
        </span>
        <span className="flex-1" />
        {sendNow && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!trimmed}
            title="Save and send to the agent (⌘⇧↵)"
            onClick={() => sendNow(trimmed)}
          >
            <Send size={14} strokeWidth={1.8} />
            Send now
          </Button>
        )}
        <Button size="sm" onClick={submit} disabled={!trimmed}>
          {submitLabel}
        </Button>
      </div>
    </>
  );
}
