import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tooltip } from './Tooltip';

/** How a mark is drawn: a hairline (strong or faint ink), a solid bar, or a
 *  hollow box — shape, not colour, tells kinds apart. */
export type RailTick = 'strong' | 'faint' | 'solid' | 'hollow';

export interface ScrollRailMark {
  key: string;
  /** Where it sits, as a fraction of the rail's height (0 top, 1 bottom). */
  at: number;
  tick: RailTick;
  /** One line, shown on hover; also the mark's accessible name. */
  label: string;
  onSelect: () => void;
}

/** The hit box around a tick, in px (`h-2`). */
const BOX_PX = 8;

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
 * style, without a background slab. Only the ticks take the pointer; the
 * surface under the rail stays clickable.
 */
export function ScrollRail({
  marks,
  height,
  right,
  'aria-label': ariaLabel,
}: {
  marks: readonly ScrollRailMark[];
  /** The rail's height in px (the surface's viewport). */
  height: number;
  /** Its distance from the surface's right edge (the scrollbar's width). */
  right: number;
  'aria-label': string;
}) {
  if (marks.length === 0 || height <= BOX_PX) return null;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="pointer-events-none absolute top-0 z-10 w-2"
      style={{ right, height }}
    >
      {marks.map((m) => (
        <Tooltip key={m.key} content={m.label} side="left" delay={150}>
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
