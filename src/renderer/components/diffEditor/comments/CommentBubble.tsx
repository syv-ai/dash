import type { Shade } from './types';

interface Props {
  shade: Shade;
  /** Short label like 'L15-18' rendered above the body text. */
  meta: string;
  text: string;
  /** Only the bottom-most bubble in a stack shows a tail. */
  hasTail: boolean;
  /** Bubble fill intensifies when the row OR this bubble is hovered. */
  isHighlighted: boolean;
  /** Pixel offset for the tail's tip from the bubble's left edge. Computed
   *  by the overlay to land at the first character of the line below. */
  tailLeftPx: number;
  onMouseEnter(): void;
  onMouseLeave(): void;
  /** Dbl-click → re-open the WIP popover prefilled with this comment's text
   *  (replaces the previous dbl-click-on-widget gesture). */
  onDoubleClick(): void;
}

/** One speech-bubble card. No backdrop blur (nothing's behind it in the
 *  viewzone-style overlay), solid semi-transparent fill matching the same
 *  hsl(--shade-N) family as the band. The tail is a CSS triangle below
 *  the bubble; its color is identical to the fill so they read as one
 *  piece. */
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
  const shadeVar = shade === 2 ? '--shade-2' : '--shade-1';
  const baseAlpha = isHighlighted ? 0.34 : 0.22;
  const fill = `hsl(var(${shadeVar}) / ${baseAlpha})`;
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
      className="relative rounded-[12px] px-[14px] pt-[9px] pb-[11px] text-[12px] leading-[1.5] tracking-[-0.005em]"
      style={{
        background: fill,
        color: 'hsl(var(--foreground) / 0.92)',
        boxShadow:
          '0 6px 20px -8px hsl(0 0% 0% / 0.18), 0 1px 2px -1px hsl(0 0% 0% / 0.08), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
        transition: 'background 180ms ease',
      }}
    >
      <div className="font-mono text-[10px] text-muted-foreground mb-[2px] tracking-normal">
        {meta}
      </div>
      <div className="whitespace-pre-wrap break-words">{text}</div>
      {hasTail && (
        <span
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            bottom: -7,
            left: tailLeftPx,
            width: 0,
            height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: `7px solid ${fill}`,
            filter: 'drop-shadow(0 3px 2px hsl(0 0% 0% / 0.12))',
            transition: 'border-top-color 180ms ease',
          }}
        />
      )}
    </div>
  );
}
