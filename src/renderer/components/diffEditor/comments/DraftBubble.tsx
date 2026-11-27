import type { ComponentProps } from 'react';
import { BubbleHeader } from './BubbleHeader';
import { BubbleShell } from './BubbleShell';
import { CommentInputBar, type ComposerKind } from './CommentInputBar';
import type { LineRange } from './types';

interface Props {
  range: LineRange;
  /** Prefilled text when re-opening to edit a persisted comment. Empty
   *  string for a fresh draft. */
  initialText: string;
  tailLeftPx: number;
  submitLabel?: string;
  /** A fresh draft's note/comment switch; absent when editing. */
  kind?: ComposerKind;
  /** Editing a persisted card: its header, kept as it was read, so only the
   *  text turns editable and the footer grows below it. */
  editing?: ComponentProps<typeof BubbleHeader>;
  /** Save a fresh note and send it to the agent at once. */
  onSendNow?(text: string): void;
  onSubmit(text: string): void;
  onCancel(): void;
}

/** Bubble-chrome wrapper around the existing CommentInputBar. Same shell as
 *  the persisted CommentBubble so creation and reading feel like one
 *  material; an edit keeps the card's header and rule, so read and edit
 *  differ only in the text field and the footer. Always shade-1 (a draft
 *  has no overlap relationship yet). */
export function DraftBubble({
  range,
  initialText,
  tailLeftPx,
  submitLabel,
  kind,
  editing,
  onSendNow,
  onSubmit,
  onCancel,
}: Props) {
  const ruleKind = editing?.kind ?? kind?.value;
  return (
    <BubbleShell
      shade={1}
      hasTail
      tailLeftPx={tailLeftPx}
      rule={ruleKind ? (ruleKind === 'note' ? 'dashed' : 'solid') : undefined}
    >
      <div className="flex flex-col gap-2">
        <CommentInputBar
          lineRange={range}
          header={editing && <BubbleHeader {...editing} />}
          cancelButton={!!editing}
          initialText={initialText}
          submitLabel={submitLabel}
          kind={kind}
          onSendNow={onSendNow}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </BubbleShell>
  );
}
