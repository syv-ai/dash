import type { Terminal } from '@xterm/xterm';

/** The one xterm internal this needs: its render service's unbatched render. */
interface RenderServiceInternals {
  _renderRows?: (start: number, end: number) => void;
}

/**
 * Repaints `terminal` in the same frame its WebGL `canvas` is resized; returns
 * a disconnect.
 *
 * xterm's WebGL renderer sizes its canvas to the box's device pixels (a
 * ResizeObserver on `device-pixel-content-box`). Setting a canvas's size
 * clears it, and the renderer only asks for a repaint, which its render
 * debouncer runs on the next animation frame, so the frame in between shows a
 * blank terminal. At a fractional device pixel ratio (Dash's default zoom
 * makes it one) the box's device width flips by a pixel as its left edge
 * crosses pixel boundaries, so a terminal that only slides sideways clears on
 * about every other frame: the main column's Claude Code terminal flickered
 * all through a ⌘B ease with the task sidebar expanded, which holds the
 * column's width but moves it (F1).
 *
 * This observes the same box from an observer created after xterm's
 * (observers run in creation order) and renders at once, before the frame
 * paints. It uses xterm's private `_renderRows` (as `proposeDims` reads its
 * render dimensions); if a release moves it, this does nothing and the
 * flicker comes back rather than anything breaking.
 */
export function repaintOnCanvasResize(terminal: Terminal, canvas: HTMLCanvasElement): () => void {
  const renderService = (
    terminal as unknown as { _core?: { _renderService?: RenderServiceInternals } }
  )._core?._renderService;
  if (typeof renderService?._renderRows !== 'function') return () => {};
  const observer = new ResizeObserver(() => {
    renderService._renderRows?.(0, terminal.rows - 1);
  });
  observer.observe(canvas, { box: 'device-pixel-content-box' });
  return () => observer.disconnect();
}
