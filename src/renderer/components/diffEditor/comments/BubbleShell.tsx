import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import type { Shade } from './types';
import { EASE, MOTION_MS } from '../../../lib/motion';

/** A bubble's fade (in as it opens, out as it folds), inside the editor's
 *  view zone that grows over `MOTION_MS.slow` (`useViewzones`). */
export const BUBBLE_FADE = `opacity ${MOTION_MS.calm}ms ${EASE.settle}`;

interface Props {
  shade: Shade;
  /** Only the bottom-most bubble in a stack shows a tail. */
  hasTail: boolean;
  /** Bubble fill intensifies when the row OR this bubble is hovered.
   *  Drafts pass `false`. */
  isHighlighted?: boolean;
  /** Pixel offset for the tail's tip from the bubble's left edge. */
  tailLeftPx: number;
  onMouseEnter?(): void;
  onMouseLeave?(): void;
  onDoubleClick?(): void;
  /** The kind's left rule: dashed for a note to the agent, solid for a PR
   *  comment (D10: shape, not colour). */
  rule?: 'dashed' | 'solid';
  children: ReactNode;
}

/** Reusable bubble chrome — rounded corners, soft shadow, downward tail.
 *  Used by both CommentBubble (persisted) and DraftBubble (WIP input) so
 *  reading and writing share one visual language. */
export function BubbleShell({
  shade,
  hasTail,
  isHighlighted = false,
  tailLeftPx,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
  rule,
  children,
}: Props) {
  const shadeVar = shade === 2 ? '--shade-2' : '--shade-1';
  const baseAlpha = isHighlighted ? 0.14 : 0.08;
  const fill = `hsl(var(${shadeVar}) / ${baseAlpha})`;
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
      className={cn(
        'relative rounded-xl px-4 py-6 text-base leading-relaxed tracking-[-0.005em]',
        rule && 'border-l-2 border-ink-3',
        rule === 'dashed' && 'border-dashed',
      )}
      style={{
        background: fill,
        color: 'hsl(var(--foreground) / 0.92)',
        boxShadow:
          '0 6px 20px -8px hsl(0 0% 0% / 0.18), 0 1px 2px -1px hsl(0 0% 0% / 0.08), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
        transition: `background ${MOTION_MS.quick}ms ${EASE.settle}`,
      }}
    >
      {children}
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
            transition: `border-top-color ${MOTION_MS.quick}ms ${EASE.settle}`,
          }}
        />
      )}
    </div>
  );
}
