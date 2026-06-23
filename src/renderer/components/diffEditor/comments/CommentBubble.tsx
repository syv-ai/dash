import { X } from 'lucide-react';
import type { Shade } from './types';
import { BubbleShell } from './BubbleShell';

interface Props {
  shade: Shade;
  /** Short label like 'L15-18' rendered above the body text. */
  meta: string;
  text: string;
  /** Already pushed to the agent — the card dims to read as "done". */
  sent: boolean;
  /** Origin tag (e.g. 'Working tree', 'Commit abc1234') shown when the open
   *  view isn't the plain working tree, so it's clear which diff this anchors
   *  to. Undefined → no tag. */
  scopeLabel?: string;
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
  /** True when this comment is currently being edited — the persisted
   *  card fades to opacity 0 while the DraftBubble crossfades in beside
   *  it, so the read-only → editable transition reads as a single morph
   *  instead of an unmount + remount pop. */
  isFadingOut: boolean;
}

/** One persisted speech-bubble card. Thin wrapper around BubbleShell that
 *  renders the meta line + body text + a hover-revealed delete button. */
export function CommentBubble({
  shade,
  meta,
  text,
  sent,
  scopeLabel,
  hasTail,
  isHighlighted,
  tailLeftPx,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
  onDelete,
  isFadingOut,
}: Props) {
  // A sent comment fades back so it reads as "already pushed" without
  // disappearing (it stays editable/removable). A bubble mid-edit takes
  // precedence and fades fully out as the draft crossfades in.
  const opacity = isFadingOut ? 0 : sent ? 0.4 : 1;
  return (
    <div
      style={{
        opacity,
        transition: 'opacity 240ms ease-out',
        pointerEvents: isFadingOut ? 'none' : 'auto',
      }}
    >
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
          <div className="flex items-center gap-[6px] mb-[2px]">
            <span className="font-mono text-[10px] text-muted-foreground/55 tracking-normal">
              {meta}
            </span>
            {scopeLabel && (
              <span className="rounded-[3px] bg-primary/12 px-[5px] py-[1px] text-[9px] font-medium text-primary/80">
                {scopeLabel}
              </span>
            )}
            {sent && (
              <span className="rounded-[3px] bg-foreground/10 px-[5px] py-[1px] text-[9px] font-medium uppercase tracking-[0.04em] text-muted-foreground/75">
                Sent
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap wrap-break-word">{text}</div>
        </div>
      </BubbleShell>
    </div>
  );
}
