import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tooltip, type TooltipContent } from './Tooltip';

/** How a mark is drawn: a hairline (strong or faint ink), a solid bar, or a
 *  hollow box — shape, not colour, tells kinds apart. */
export type RailTick = 'strong' | 'faint' | 'solid' | 'hollow';

export interface ScrollRailMark {
  key: string;
  /** Where it sits, as a fraction of the rail's height (0 top, 1 bottom). */
  at: number;
  tick: RailTick;
  /** One line: the mark's accessible name, and its hover unless `tip` says more. */
  label: string;
  /** A richer hover (a card) in place of `label`. */
  tip?: TooltipContent;
  onSelect: () => void;
}

/** A stretch of the document a segment under the ticks covers: lines
 *  added, removed (a point), or replaced. Colour is the loc pair's. */
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

/** The hit box around a tick, in px (`h-2`). */
const BOX_PX = 8;
/** A segment's least drawn height, and its least hit box, in px. */
const SPAN_MIN_PX = 2;
const SPAN_BOX_PX = 6;

const spanVariants = cva('block w-1 rounded-full transition-opacity group-hover/span:opacity-100', {
  variants: {
    tone: {
      add: 'bg-loc-add opacity-60',
      del: 'bg-loc-del opacity-70',
      mod: 'bg-ink-3 opacity-50',
    },
  },
});

const tickVariants = cva('block w-full', {
  variants: {
    tick: {
      strong: 'h-0.5 bg-ink-2',
      faint: 'h-0.5 bg-ink-3',
      solid: 'h-1 bg-ink',
      hollow: 'h-1.5 border border-ink-2',
    },
  },
});

/**
 * A slim, transparent rail of clickable ticks over a scrolling surface's right
 * edge, beside its scrollbar: where things are in the whole document, minimap
 * style, without a background slab. `spans` draw under the ticks as thin
 * segments down the rail's left edge (a diff's changes), so a tick always
 * stays on top. Only ticks and segments take the pointer; the surface under
 * the rail stays clickable.
 */
export function ScrollRail({
  marks,
  spans = [],
  height,
  right,
  'aria-label': ariaLabel,
}: {
  marks: readonly ScrollRailMark[];
  spans?: readonly ScrollRailSpan[];
  /** The rail's height in px (the surface's viewport). */
  height: number;
  /** Its distance from the surface's right edge (the scrollbar's width). */
  right: number;
  'aria-label': string;
}) {
  if ((marks.length === 0 && spans.length === 0) || height <= BOX_PX) return null;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="pointer-events-none absolute top-0 z-10 w-2"
      style={{ right, height }}
    >
      {spans.map((s) => {
        const drawn = Math.max(s.size * height, SPAN_MIN_PX);
        const box = Math.max(drawn, SPAN_BOX_PX);
        const top = Math.min(Math.max(s.at * height - (box - drawn) / 2, 0), height - box);
        return (
          <Tooltip key={s.key} content={s.label} side="left" delay={150}>
            <button
              type="button"
              aria-label={s.label}
              onClick={s.onSelect}
              className={cn(
                'group/span pointer-events-auto absolute inset-x-0 flex cursor-pointer items-center',
                focusRing,
              )}
              style={{ top, height: box }}
            >
              <span className={spanVariants({ tone: s.tone })} style={{ height: drawn }} />
            </button>
          </Tooltip>
        );
      })}
      {marks.map((m) => (
        <Tooltip key={m.key} content={m.tip ?? m.label} side="left" delay={150}>
          <button
            type="button"
            aria-label={m.label}
            onClick={m.onSelect}
            className={cn(
              'pointer-events-auto absolute inset-x-0 flex h-2 cursor-pointer items-center',
              focusRing,
            )}
            style={{
              top: Math.min(Math.max(m.at * height - BOX_PX / 2, 0), height - BOX_PX),
            }}
          >
            <span className={tickVariants({ tick: m.tick })} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
