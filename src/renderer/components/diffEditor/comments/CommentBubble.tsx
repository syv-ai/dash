import { X } from 'lucide-react';
import type { Shade } from './types';
import { BubbleShell } from './BubbleShell';

interface Props {
  shade: Shade;
  /** Short label like 'L15-18' rendered above the body text. */
  meta: string;
  text: string;
  /** Only the bottom-most bubble in a stack shows a tail. */
  hasTail: boolean;
  /** Bubble fill intensifies when the row OR this bubble is hovered. */
  isHighlighted: boolean;
  tailLeftPx: number;
  onMouseEnter(): void;
  onMouseLeave(): void;
  /** Dbl-click → re-open the WIP input prefilled with this comment's text. */
  onDoubleClick(): void;
  /** Click the in-bubble × → delete this comment. ESC is taken by the
   *  surrounding Modal, so a button is the keyboard-free path. */
  onDelete(): void;
}

/** One persisted speech-bubble card. Thin wrapper around BubbleShell that
 *  renders the meta line + body text + a hover-revealed delete button. */
export function CommentBubble({
  shade,
  meta,
  text,
  hasTail,
  isHighlighted,
  tailLeftPx,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
  onDelete,
}: Props) {
  return (
    <BubbleShell
      shade={shade}
      hasTail={hasTail}
      isHighlighted={isHighlighted}
      tailLeftPx={tailLeftPx}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
    >
      <div className="group/bubble">
        <button
          type="button"
          aria-label="Delete comment"
          title="Delete comment"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-[6px] right-[6px] flex h-[20px] w-[20px] items-center justify-center rounded-[4px] text-muted-foreground/60 opacity-40 hover:opacity-100 hover:text-foreground hover:bg-foreground/10 transition-opacity z-10"
        >
          <X size={13} strokeWidth={1.8} />
        </button>
        <div className="font-mono text-[10px] text-muted-foreground/55 mb-[2px] tracking-normal">
          {meta}
        </div>
        <div className="whitespace-pre-wrap break-words">{text}</div>
      </div>
    </BubbleShell>
  );
}
