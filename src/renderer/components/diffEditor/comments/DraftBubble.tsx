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
  /** Save a fresh note and send it to the agent at once. */
  onSendNow?(text: string): void;
  onSubmit(text: string): void;
  onCancel(): void;
}

/** Bubble-chrome wrapper around the existing CommentInputBar. Same shell as
 *  the persisted CommentBubble so creation and reading feel like one
 *  material. Always shade-1 (a draft has no overlap relationship yet). */
export function DraftBubble({
  range,
  initialText,
  tailLeftPx,
  submitLabel,
  kind,
  onSendNow,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <BubbleShell
      shade={1}
      hasTail
      tailLeftPx={tailLeftPx}
      rule={kind ? (kind.value === 'note' ? 'dashed' : 'solid') : undefined}
    >
      <div className="flex flex-col gap-1.5">
        <CommentInputBar
          lineRange={range}
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
