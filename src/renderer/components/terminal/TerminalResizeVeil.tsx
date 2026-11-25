import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { ResizeVeil } from '../../terminal/resizeVeil';
import { cn } from '../../lib/cn';

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
 * so its stretched grid and the program's redraw don't show; fades in and
 * out. Pointer events pass through, and the keyboard stays with xterm, so it
 * never blocks input. Place it over the pane's terminal, in a `relative` box.
 */
export function TerminalResizeVeil({ id }: { id: string | null }) {
  const shown = useResizeVeil(id);
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-ground',
        'transition-opacity duration-120 ease-out motion-reduce:transition-none',
        shown ? 'opacity-100' : 'opacity-0',
      )}
    >
      {shown && <Loader2 size={14} strokeWidth={1.8} className="animate-spin text-icon" />}
    </div>
  );
}
