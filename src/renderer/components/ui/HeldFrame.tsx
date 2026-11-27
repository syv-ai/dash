import type { CSSProperties, ReactNode, Ref } from 'react';
import { cn } from '../../lib/cn';
import type { Held } from '../../lib/railCrossing';
import { useRailDrag } from './Resizable';

/** The content's look as it crosses to or from the rail. */
const FADE = {
  in: 'motion-safe:animate-fade-in',
  out: 'opacity-0 transition-opacity duration-calm ease-settle motion-reduce:transition-none',
} as const;

/**
 * A panel's content, held at a width while the panel eases (`held`): it
 * paints at that width, clipped here, so it never re-lays out mid-ease, and
 * fades as it crosses to or from the rail (`lib/railCrossing`). `railed`: the
 * panel shows its rail now, which fades in as it comes. The content stays
 * mounted throughout. `overflow-clip`, not hidden: a clip can't be scrolled,
 * so content taking focus mid-motion can't slide the held layout. In a
 * panel dragged out of its rail (`ResizablePanel dragOpen`), the rail holds
 * its width on its outer side while the pointer is down, and the content
 * the drag's hold once released (`useRailDrag`).
 */
export function HeldFrame({
  held,
  railed = false,
  bodyRef,
  children,
}: {
  held: Held | null;
  railed?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const drag = useRailDrag();
  const hold = drag.rail ? { width: drag.rail.width } : (held ?? drag.held);
  return (
    <div className={cn('h-full overflow-clip', railed && 'motion-safe:animate-fade-in')}>
      <div
        ref={bodyRef}
        className={cn(
          'h-full',
          hold && 'w-(--held-width)',
          drag.rail?.align === 'end' && 'ml-auto',
          hold?.fade && FADE[hold.fade],
        )}
        style={hold ? ({ '--held-width': `${hold.width}px` } as CSSProperties) : undefined}
      >
        {children}
      </div>
    </div>
  );
}
