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
}

/** One persisted speech-bubble card. Thin wrapper around BubbleShell that
 *  renders the meta line + body text. */
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
      <div className="font-mono text-[10px] text-muted-foreground mb-[2px] tracking-normal">
        {meta}
      </div>
      <div className="whitespace-pre-wrap break-words">{text}</div>
    </BubbleShell>
  );
}
