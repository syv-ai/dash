import type * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { RAIL_HIT_MIN_PX, RAIL_WIDTH_PX, railBar } from './railBar';
import { Tooltip, type TooltipContent } from './Tooltip';

/** How a mark is drawn: a bar in strong or faint ink, a solid bar in full
 *  ink, or a hollow box — shape and ink, not colour, tell kinds apart. */
export type RailTick = 'strong' | 'faint' | 'solid' | 'hollow';

export interface ScrollRailMark {
  key: string;
  /** Its top, as a fraction of the rail's height (0 top, 1 bottom). */
  at: number;
  /** Its height, as a fraction of the rail's height (0 for one point). */
  size: number;
  tick: RailTick;
  /** One line: the mark's accessible name, and its hover unless `tip` says more. */
  label: string;
  /** A richer hover (a card) in place of `label`. */
  tip?: TooltipContent;
  onSelect: () => void;
}

/** A stretch of the document a bar in the change lane covers: lines added,
 *  removed (a point), or replaced. Colour is the loc pair's. */
export type RailSpanTone = 'add' | 'del' | 'mod';

export interface ScrollRailSpan {
  key: string;
  /** Its top, as a fraction of the rail's height. */
  at: number;
  /** Its height, as a fraction of the rail's height (0 for a point). */
  size: number;
  tone: RailSpanTone;
  /** One line: its accessible name and hover. */
  label: string;
  onSelect: () => void;
}

const spanVariants = cva('absolute left-0 w-1', {
  variants: {
    tone: {
      add: 'bg-loc-add',
      del: 'bg-loc-del',
      mod: 'bg-ink-3',
    },
  },
});

const tickVariants = cva('absolute inset-x-0', {
  variants: {
    tick: {
      strong: 'bg-ink-2',
      faint: 'bg-ink-3',
      solid: 'bg-ink',
      hollow: 'border-2 border-ink-2',
    },
  },
});

/** A clickable bar: its hit box (at least `RAIL_HIT_MIN_PX`), the bar drawn
 *  inside it (at least `RAIL_BAR_MIN_PX`), both centred on the stretch. */
function Bar({
  at,
  size,
  height,
  label,
  tip,
  onSelect,
  lane,
  children,
}: {
  at: number;
  size: number;
  height: number;
  label: string;
  tip?: TooltipContent;
  onSelect: () => void;
  lane: string;
  children: (offset: number, drawn: number) => React.ReactNode;
}) {
  const bar = railBar(at, size, height);
  const hit = railBar(at, size, height, RAIL_HIT_MIN_PX);
  return (
    <Tooltip content={tip ?? label} side="left" delay={150}>
      <button
        type="button"
        aria-label={label}
        onClick={onSelect}
        className={cn('pointer-events-auto absolute cursor-pointer', lane, focusRing)}
        style={{ top: hit.top, height: hit.height }}
      >
        {children(bar.top - hit.top, bar.height)}
      </button>
    </Tooltip>
  );
}

/**
 * A slim, transparent rail of clickable bars in a scrolling surface's
 * scrollbar column (`RAIL_WIDTH_PX` wide; size the scrollbar to match): where
 * things are in the whole document, minimap style, without a background slab.
 * Two lanes: `spans` (a diff's changes) down the left, `marks` (threads,
 * comments, notes) down the right, so neither hides the other. Each bar spans
 * its stretch, never under `RAIL_BAR_MIN_PX` tall. Only the bars take the
 * pointer; the track under the rail keeps its clicks, and a slider stacked
 * above it (`z-11`) drags over the bars.
 */
export function ScrollRail({
  marks,
  spans = [],
  height,
  'aria-label': ariaLabel,
}: {
  marks: readonly ScrollRailMark[];
  spans?: readonly ScrollRailSpan[];
  /** The rail's height in px (the surface's viewport). */
  height: number;
  'aria-label': string;
}) {
  if ((marks.length === 0 && spans.length === 0) || height <= RAIL_HIT_MIN_PX) return null;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="pointer-events-none absolute top-0 right-0 z-10"
      style={{ width: RAIL_WIDTH_PX, height }}
    >
      {spans.map((s) => (
        <Bar
          key={s.key}
          at={s.at}
          size={s.size}
          height={height}
          label={s.label}
          onSelect={s.onSelect}
          lane="left-0 w-1.5"
        >
          {(top, drawn) => (
            <span className={spanVariants({ tone: s.tone })} style={{ top, height: drawn }} />
          )}
        </Bar>
      ))}
      {marks.map((m) => (
        <Bar
          key={m.key}
          at={m.at}
          size={m.size}
          height={height}
          label={m.label}
          tip={m.tip}
          onSelect={m.onSelect}
          lane="right-0 w-1.5"
        >
          {(top, drawn) => (
            <span className={tickVariants({ tick: m.tick })} style={{ top, height: drawn }} />
          )}
        </Bar>
      ))}
    </div>
  );
}
