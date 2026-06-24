import type { LiveComment, Shade } from './types';
import { CommentBubble } from './CommentBubble';

interface Props {
  /** Comments anchored at this line. ≥1; >1 means stacked. */
  comments: LiveComment[];
  /** Shade per comment id — passed through from the overlay's assignment pass. */
  shadeById: ReadonlyMap<string, Shade>;
  /** Hovered comment id, or null. Drives per-bubble highlight. */
  hoveredId: string | null;
  /** Pixel offset for the tail's tip from the bubble's left edge. */
  tailLeftPx: number;
  onBubbleHover(id: string | null): void;
  /** Dbl-click on a bubble → re-open the WIP popover prefilled with that
   *  comment's text. */
  onEdit(comment: LiveComment): void;
  /** Click the in-bubble × → delete this comment. */
  onDelete(id: string): void;
  /** Origin tag for every bubble in this view (e.g. 'Commit abc1234'), or
   *  undefined in the plain working view where no tag is needed. */
  scopeLabel?: string;
  /** Id of the comment currently being edited — its persisted card fades
   *  out as the DraftBubble crossfades in beside it. Null when nothing is
   *  being edited. */
  editingId: string | null;
}

function metaLabel(c: LiveComment): string {
  return c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-${c.endLine}`;
}

/** A vertical stack of one or more speech bubbles. Only the bottom-most
 *  bubble carries a tail. Caller decides whether to render this — when
 *  the comment block is collapsed, simply don't mount this. */
export function BubbleStack({
  comments,
  shadeById,
  hoveredId,
  tailLeftPx,
  onBubbleHover,
  onEdit,
  onDelete,
  editingId,
  scopeLabel,
}: Props) {
  const stacked = comments.length >= 2;
  return (
    <div className="flex flex-col gap-[4px] pointer-events-auto">
      {comments.map((c, i) => {
        const shade = shadeById.get(c.id) ?? 1;
        const isLast = i === comments.length - 1;
        return (
          <CommentBubble
            key={c.id}
            shade={shade}
            meta={
              stacked ? `${metaLabel(c)} — comment ${i + 1} of ${comments.length}` : metaLabel(c)
            }
            text={c.text}
            sent={c.sent}
            scopeLabel={scopeLabel}
            hasTail={isLast}
            isHighlighted={hoveredId === c.id}
            tailLeftPx={tailLeftPx}
            onMouseEnter={() => onBubbleHover(c.id)}
            onMouseLeave={() => onBubbleHover(null)}
            onDoubleClick={() => onEdit(c)}
            onDelete={() => onDelete(c.id)}
            isFadingOut={c.id === editingId}
          />
        );
      })}
    </div>
  );
}
