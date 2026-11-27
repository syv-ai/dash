import type { CSSProperties, ReactNode, Ref } from 'react';
import { cn } from '../../lib/cn';
import type { Held } from '../../lib/railCrossing';

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
 * so content taking focus mid-motion can't slide the held layout.
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
  return (
    <div className={cn('h-full overflow-clip', railed && 'motion-safe:animate-fade-in')}>
      <div
        ref={bodyRef}
        className={cn('h-full', held && 'w-(--held-width)', held?.fade && FADE[held.fade])}
        style={held ? ({ '--held-width': `${held.width}px` } as CSSProperties) : undefined}
      >
        {children}
      </div>
    </div>
  );
}
