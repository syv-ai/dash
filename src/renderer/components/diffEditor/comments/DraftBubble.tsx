import { BubbleShell } from './BubbleShell';
import { CommentInputBar } from './CommentInputBar';
import type { LineRange } from './types';

interface Props {
  range: LineRange;
  /** Prefilled text when re-opening to edit a persisted comment. Empty
   *  string for a fresh draft. */
  initialText: string;
  tailLeftPx: number;
  onSubmit(text: string): void;
  onCancel(): void;
}

/** Bubble-chrome wrapper around the existing CommentInputBar. Same shell as
 *  the persisted CommentBubble so creation and reading feel like one
 *  material. Always shade-1 (a draft has no overlap relationship yet). */
export function DraftBubble({ range, initialText, tailLeftPx, onSubmit, onCancel }: Props) {
  return (
    <BubbleShell shade={1} hasTail tailLeftPx={tailLeftPx}>
      <div className="flex flex-col gap-1.5 h-[110px]">
        <CommentInputBar
          lineRange={range}
          initialText={initialText}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </div>
    </BubbleShell>
  );
}
