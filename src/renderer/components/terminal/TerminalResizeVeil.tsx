import { cn } from '../../lib/cn';
import { sheetSurface } from '../ui/FolderTab';
import { useEffect, useState } from 'react';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { ResizeVeil } from '../../terminal/resizeVeil';

/** Whether terminal `id`'s veil shows: from its grid starting to change size
 *  until the fit and the program's redraw have settled (`ResizeVeil`). */
export function useResizeVeil(id: string | null): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!id) return;
    const veil = new ResizeVeil(setShown);
    const off = sessionRegistry.onActivity(id, (activity) => veil.report(activity));
    return () => {
      off();
      veil.dispose();
      setShown(false);
    };
  }, [id]);
  return shown;
}

/**
 * Covers a terminal pane while its size changes (a sidebar easing, a drag),
 * so its stretched grid and the program's redraw don't show: a `ground`
 * curtain that drops in at once and, as the veil lifts, sweeps off left to
 * right, revealing the settled terminal behind it (`.terminal-curtain` in
 * index.css). Pointer events pass through, and the keyboard stays with
 * xterm, so it never blocks input. Place it over the pane's terminal, in a
 * `relative` box.
 */
export function TerminalResizeVeil({ id }: { id: string | null }) {
  const shown = useResizeVeil(id);
  return (
    <div
      aria-hidden
      data-shown={shown || undefined}
      className={cn(
        'terminal-curtain pointer-events-none absolute inset-0 z-10',
        // The terminal's own sheet, so the sweep reads as the pane, not a block.
        sheetSurface,
      )}
    />
  );
}
