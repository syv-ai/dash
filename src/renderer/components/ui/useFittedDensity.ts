import * as React from 'react';

/**
 * The first of `densities` (widest first) whose natural width fits
 * `available`, or null when none does; `needs` holds their natural widths,
 * in that order.
 */
export function firstFitting<D>(
  available: number,
  needs: readonly number[],
  densities: readonly D[],
): D | null {
  // Half a pixel of slack: layout widths are fractional, client widths not.
  return densities.find((_, i) => (needs[i] ?? Infinity) <= available + 0.5) ?? null;
}

/**
 * Fits a row of options to its width: `sizerRef`'s children are invisible
 * copies of the row, one per measured density, widest first; `rootRef` is the
 * room it has. `pick` turns the room and the copies' widths into a density.
 * Re-measures as either resizes. `needs`: the copies' natural widths, rounded
 * up (empty until measured).
 */
export function useFittedDensity<D>(
  pick: (available: number, needs: readonly number[]) => D,
  initial: D,
  /** Re-observes the copies when it changes (their number, say). */
  rowsKey: unknown,
) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sizerRef = React.useRef<HTMLDivElement>(null);
  const [density, setDensity] = React.useState<D>(initial);
  const [needs, setNeeds] = React.useState<readonly number[]>([]);
  const pickRef = React.useRef(pick);
  pickRef.current = pick;

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const sizer = sizerRef.current;
    if (!root || !sizer) return;
    const fit = () => {
      // Not rendered (a hidden ancestor, e.g. the collapsed task sidebar):
      // every copy measures 0, which would report a least width of nothing
      // and feed back into its host's layout. Keep the last real measure.
      if (root.getClientRects().length === 0) return;
      // Rects are scaled by any transform above (a dialog's scale-in), and
      // `clientWidth` isn't: unscale them, or a row measured mid-animation
      // reads too narrow and truncates for good (no resize follows).
      const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
      const widths = Array.from(
        sizer.children,
        (row) => row.getBoundingClientRect().width / (scale || 1),
      );
      const rounded = widths.map(Math.ceil);
      setNeeds((was) =>
        was.length === rounded.length && was.every((w, i) => w === rounded[i]) ? was : rounded,
      );
      setDensity(pickRef.current(root.clientWidth, widths));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    for (const row of sizer.children) observer.observe(row);
    return () => observer.disconnect();
  }, [rowsKey]);

  return { rootRef, sizerRef, density, needs };
}
