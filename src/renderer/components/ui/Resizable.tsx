import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from 'react';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type GroupProps,
  type PanelImperativeHandle,
  type PanelProps,
  type PanelSize,
  type SeparatorProps,
} from 'react-resizable-panels';
import { flushSync } from 'react-dom';
import { cn } from '../../lib/cn';
import { MOTION_MS, reducedMotion } from '../../lib/motion';
import { heldAcrossRail, RAIL_DRAG_SLOP_PX, railDragEnd, type Held } from '../../lib/railCrossing';

export type { PanelImperativeHandle, PanelSize };

/** How long an animated panel eases: `--motion-slow`, as `[data-animating]`
 *  in index.css takes it. */
export const PANEL_EASE_MS = MOTION_MS.slow;
/** The task sidebar's planned motion (narrow ⇄ expanded, closing the editor,
 *  hide ⇄ show), slower and calmer: the panels take it while an ancestor sets
 *  `--panel-ease` to it (D258, D264). */
export const EXPAND_EASE_MS = 1000;

/** The ease's length now (`ms`, the panels' own by default): 0 when the user
 *  prefers reduced motion (the CSS drops the transition then too). Clear an
 *  `animate` flag after this. */
export function panelEaseMs(ms: number = PANEL_EASE_MS): number {
  return reducedMotion() ? 0 : ms;
}

/*
 * Resizable split views, shadcn-style, over react-resizable-panels v4.
 *
 * Sizes follow the library: a number is pixels, a string is a percentage
 * ("22%" or "22"). Double-clicking a handle resets its panel to `defaultSize`.
 */

interface ResizablePanelGroupProps extends GroupProps {
  /** Persist the layout in localStorage under this id. */
  autoSaveId?: string;
  /** With `autoSaveId`, when panels mount conditionally: the ids rendered now,
   *  so each combination keeps its own saved layout. */
  panelIds?: string[];
}

export function ResizablePanelGroup({ autoSaveId, panelIds, ...props }: ResizablePanelGroupProps) {
  return autoSaveId ? (
    <PersistedPanelGroup autoSaveId={autoSaveId} panelIds={panelIds} {...props} />
  ) : (
    <PanelGroupBase {...props} />
  );
}

function PersistedPanelGroup({
  autoSaveId,
  panelIds,
  onLayoutChanged,
  ...props
}: GroupProps & { autoSaveId: string; panelIds?: string[] }) {
  const saved = useDefaultLayout({ id: autoSaveId, panelIds, storage: localStorage });
  return (
    <PanelGroupBase
      defaultLayout={saved.defaultLayout}
      onLayoutChanged={(layout, meta) => {
        saved.onLayoutChanged(layout, meta);
        onLayoutChanged?.(layout, meta);
      }}
      {...props}
    />
  );
}

function PanelGroupBase({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn('h-full w-full', className)}
      {...props}
    />
  );
}

/**
 * A panel's content as a drag out of its rail has it (`dragOpen`), for its
 * `ui/HeldFrame`: `rail`, while the pointer is down, the rail held at its
 * width on the side away from the handle (the panel opens beside it, the
 * rail staying put, X2); `held`, once released open, the content held at
 * the width it settles at and fading in while the panel eases there.
 */
export interface RailDrag {
  rail: { width: number; align: 'start' | 'end' } | null;
  held: Held | null;
}

const RailDragContext = createContext<RailDrag>({ rail: null, held: null });

/** The enclosing panel's drag out of its rail (`ResizablePanel dragOpen`). */
export function useRailDrag(): RailDrag {
  return useContext(RailDragContext);
}

/** A panel size prop in px: a number is px, a string a percentage of
 *  `groupPx` ("22%" or "22") unless it says px. */
function sizePx(size: PanelProps['minSize'], groupPx: number): number {
  if (size === undefined) return 0;
  if (typeof size === 'number') return size;
  const n = Number.parseFloat(size);
  return size.trim().endsWith('px') ? n : (n / 100) * groupPx;
}

/** Eases every panel in `group` for `ms` (`[data-easing]` in index.css):
 *  a snap moves the panel's neighbours with it. */
function easeGroup(group: HTMLElement | null, ms: number): () => void {
  if (!group || ms === 0) return () => {};
  group.setAttribute('data-easing', '');
  const timer = window.setTimeout(() => group.removeAttribute('data-easing'), ms);
  return () => {
    window.clearTimeout(timer);
    group.removeAttribute('data-easing');
  };
}

interface ResizablePanelProps extends PanelProps {
  /** Ease size changes (collapse, expand, imperative resize) while true. */
  animate?: boolean;
  /** Called when the panel becomes collapsed, including on mount;
   *  `dragged`: by a drag into its rail (`dragOpen`), its content already
   *  faded out while the pointer was down. */
  onCollapse?: (how: { dragged: boolean }) => void;
  /** Called when the panel stops being collapsed, including on mount;
   *  `dragged`: by a drag out of its rail (`dragOpen`), at the width the
   *  drag left it, which is the user's. */
  onExpand?: (how: { dragged: boolean }) => void;
  /**
   * With `collapsible`: its handle drags it out of its rail (X2). The
   * library jumps a collapsed panel straight to `minSize` once a drag passes
   * half way there; here the panel follows the pointer from the rail
   * instead, its rail held as it was (`useRailDrag`), and on release it
   * settles (`railDragEnd`): back to the rail if it barely moved, else open
   * at least `minSize`, easing there with its neighbours, its content held
   * at that width and fading in. It only counts as expanded then. Dragged
   * into its rail (the library's drag), its content holds its last open
   * width, clipped, and fades out once the panel snaps to the rail; it only
   * counts as collapsed once released there, its rail fading in.
   */
  dragOpen?: boolean;
}

export function ResizablePanel({
  animate = false,
  onCollapse,
  onExpand,
  onResize,
  panelRef,
  elementRef,
  dragOpen = false,
  minSize,
  collapsedSize,
  ...props
}: ResizablePanelProps) {
  const handle = useRef<PanelImperativeHandle | null>(null);
  const element = useRef<HTMLDivElement | null>(null);
  const wasCollapsed = useRef<boolean | null>(null);
  const [railDrag, setRailDrag] = useState<RailDrag>({ rail: null, held: null });
  // Down on its handle from the rail: the panel's crossings wait for the
  // release.
  const dragging = useRef(false);
  // Its minimum is the rail's, so the panel can follow the pointer: only once
  // it has moved past the slop, as a constraint changing re-registers the
  // panel, which forgets the width `expand()` restores.
  const [relaxed, setRelaxed] = useState(false);
  // Down on its handle while open (the library's drag): crossings wait for
  // the release. `openPx`: its width as last open, which a drag into the
  // rail holds its content at.
  const closing = useRef(false);
  const openPx = useRef(0);

  const setHandle = useCallback(
    (h: PanelImperativeHandle | null) => {
      handle.current = h;
      if (typeof panelRef === 'function') panelRef(h);
      else if (panelRef) panelRef.current = h;
    },
    [panelRef],
  );
  const setElement = useCallback(
    (el: HTMLDivElement | null) => {
      element.current = el;
      if (typeof elementRef === 'function') elementRef(el);
      else if (elementRef) elementRef.current = el;
    },
    [elementRef],
  );

  const handleResize: PanelProps['onResize'] = (size, id, prev) => {
    onResize?.(size, id, prev);
    if (!handle.current || dragging.current) return;
    const collapsed = handle.current.isCollapsed();
    if (!collapsed) openPx.current = size.inPixels;
    if (closing.current) {
      // Snapped to the rail mid-drag, or back out of it: the content held
      // at its open width (fading out) or let go, before this frame paints
      // (a resize observer runs between layout and paint).
      const held: Held | null = collapsed ? { width: openPx.current, fade: 'out' } : null;
      flushSync(() => setRailDrag({ rail: null, held }));
      return;
    }
    if (collapsed === wasCollapsed.current) return;
    wasCollapsed.current = collapsed;
    if (collapsed) onCollapse?.({ dragged: false });
    else onExpand?.({ dragged: false });
  };

  // The latest props for the drag's listeners, which outlive a render.
  const latest = useRef({ minSize, collapsedSize, onExpand, onCollapse });
  latest.current = { minSize, collapsedSize, onExpand, onCollapse };

  useEffect(() => {
    if (!dragOpen) return;
    let cleanups: (() => void)[] = [];
    const clear = () => {
      cleanups.forEach((c) => c());
      cleanups = [];
    };
    const later = (fn: () => void, ms: number) => {
      const timer = window.setTimeout(fn, ms);
      cleanups.push(() => window.clearTimeout(timer));
    };
    const settle = () => {
      dragging.current = false;
      const h = handle.current;
      const el = element.current;
      if (!h || !el) {
        setRailDrag({ rail: null, held: null });
        setRelaxed(false);
        return;
      }
      const { asPercentage, inPixels } = h.getSize();
      const groupPx = asPercentage > 0 ? (inPixels * 100) / asPercentage : 0;
      const { minSize: min, collapsedSize: rail } = latest.current;
      const railPx = sizePx(rail, groupPx);
      const end = railDragEnd({ px: inPixels, railPx, minPx: sizePx(min, groupPx) });
      const ms = panelEaseMs();
      if (!end.open) {
        // Back to the rail, held as it was until the panel is.
        if (inPixels > railPx) {
          cleanups.push(easeGroup(el.parentElement, ms));
          h.resize(railPx);
        }
        later(() => {
          setRailDrag({ rail: null, held: null });
          setRelaxed(false);
        }, ms);
        return;
      }
      if (end.px > inPixels) {
        cleanups.push(easeGroup(el.parentElement, ms));
        h.resize(end.px);
      }
      const held = heldAcrossRail(
        { px: railPx, collapsed: true },
        { px: end.px, collapsed: false },
      );
      setRailDrag({ rail: null, held: ms > 0 ? (held ?? null) : null });
      setRelaxed(false);
      wasCollapsed.current = false;
      latest.current.onExpand?.({ dragged: true });
      later(() => setRailDrag({ rail: null, held: null }), ms);
    };
    // The drag is the panel's own, not the library's: its minimum is the
    // rail's while the pointer is down (so the panel can follow it), and a
    // constraint changing re-registers the group, which ends a library drag.
    const press = (e: PointerEvent) => {
      const el = element.current;
      const h = handle.current;
      if (e.button > 0 || !el || !h) return;
      const separator = e.target instanceof Element ? e.target.closest('[data-separator]') : null;
      if (!separator || separator.getAttribute('aria-disabled') === 'true') return;
      // The rail keeps the panel's outer edge, away from the handle.
      const align =
        separator === el.nextElementSibling
          ? 'start'
          : separator === el.previousElementSibling
            ? 'end'
            : null;
      if (!align) return;
      if (!h.isCollapsed()) return watchClose();
      e.preventDefault();
      e.stopPropagation();
      clear();
      const horizontal = separator.getAttribute('aria-orientation') !== 'horizontal';
      const startPx = h.getSize().inPixels;
      const startAt = horizontal ? e.clientX : e.clientY;
      // Opening away from the handle's side: rightwards (down) from a rail
      // at the start, leftwards (up) from one at the end.
      const sign = align === 'start' ? 1 : -1;
      const doc = el.ownerDocument;
      const restore = {
        cursor: doc.documentElement.style.cursor,
        select: doc.body.style.userSelect,
      };
      doc.documentElement.style.cursor = horizontal ? 'ew-resize' : 'ns-resize';
      doc.body.style.userSelect = 'none';
      separator.setAttribute('data-rail-drag', '');
      dragging.current = true;
      setRailDrag({ rail: { width: startPx, align }, held: null });
      let moved = false;
      const move = (m: PointerEvent) => {
        const by = sign * ((horizontal ? m.clientX : m.clientY) - startAt);
        if (!moved && by < RAIL_DRAG_SLOP_PX) return;
        if (!moved) setRelaxed(true);
        moved = true;
        handle.current?.resize(Math.max(startPx, startPx + by));
      };
      const release = () => {
        end();
        settle();
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
        doc.documentElement.style.cursor = restore.cursor;
        doc.body.style.userSelect = restore.select;
        separator.removeAttribute('data-rail-drag');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      cleanups.push(end);
    };
    // The library's drag of the open panel: its crossing waits for the
    // release (`handleResize` holds the content meanwhile).
    const watchClose = () => {
      clear();
      closing.current = true;
      const done = () => {
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
        if (!closing.current) return;
        closing.current = false;
        const collapsed = handle.current?.isCollapsed() ?? false;
        setRailDrag({ rail: null, held: null });
        if (collapsed === wasCollapsed.current) return;
        wasCollapsed.current = collapsed;
        if (collapsed) latest.current.onCollapse?.({ dragged: true });
        else latest.current.onExpand?.({ dragged: false });
      };
      // Bubbling, after the library's own (capture) has ended its drag.
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
      cleanups.push(() => {
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
        closing.current = false;
      });
    };
    // Capture on the window: ahead of the library's own, on the document.
    window.addEventListener('pointerdown', press, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      dragging.current = false;
      clear();
    };
  }, [dragOpen]);

  return (
    <Panel
      data-slot="resizable-panel"
      data-animating={animate || undefined}
      panelRef={setHandle}
      elementRef={setElement}
      onResize={handleResize}
      collapsedSize={collapsedSize}
      // Dragging out of the rail, the panel follows the pointer from it.
      minSize={relaxed ? collapsedSize : minSize}
      {...props}
    >
      {dragOpen ? (
        <RailDragContext.Provider value={railDrag}>{props.children}</RailDragContext.Provider>
      ) : (
        props.children
      )}
    </Panel>
  );
}

/**
 * Gives focus back once the pointer that put it on a handle lets go. The
 * library focuses a handle on pointerdown (so arrow keys can follow a drag)
 * and blurs it after a drag but not after a plain press, which left it
 * holding focus (and its hairline) until something else was clicked. Either
 * way, focus goes back to what the user was in. Keyboard
 * focus (Tab, F6) is `:focus-visible` and stays.
 */
function returnPointerFocus(e: FocusEvent<HTMLDivElement>): void {
  const handle = e.currentTarget;
  if (handle.matches(':focus-visible')) return;
  const previous = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
  const doc = handle.ownerDocument;
  const release = () => {
    doc.removeEventListener('pointerup', release, true);
    doc.removeEventListener('pointercancel', release, true);
    // After a drag the library has already blurred the handle (focus is on
    // the body); after a press without one, the handle still holds it.
    const active = doc.activeElement;
    if (active !== handle && active !== doc.body) return;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
    else handle.blur();
  };
  doc.addEventListener('pointerup', release, true);
  doc.addEventListener('pointercancel', release, true);
}

/**
 * An invisible 8px hit area straddling the panel edge (it takes no layout
 * space); a 2px hairline shows on hover, drag and keyboard focus. A drag
 * doesn't leave it focused.
 */
export function ResizableHandle({ className, onFocusCapture, ...props }: SeparatorProps) {
  return (
    <Separator
      data-slot="resizable-handle"
      // The library sets its own onFocus over any passed in.
      onFocusCapture={(e) => {
        onFocusCapture?.(e);
        returnPointerFocus(e);
      }}
      className={cn(
        'relative z-10 shrink-0 outline-none',
        'after:absolute after:rounded-full after:bg-transparent after:transition-colors after:delay-100',
        'data-[separator=hover]:after:bg-ink-3 data-[separator=active]:after:bg-ink-3 focus-visible:after:bg-ink-3',
        // A drag out of a rail (`ResizablePanel dragOpen`), the panel's own.
        'data-rail-drag:after:bg-ink-3',
        // Between columns (the separator itself is vertical).
        'aria-[orientation=vertical]:-mx-1 aria-[orientation=vertical]:w-2',
        'aria-[orientation=vertical]:after:inset-y-4 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-0.5 aria-[orientation=vertical]:after:-translate-x-1/2',
        // Between rows.
        'aria-[orientation=horizontal]:-my-1 aria-[orientation=horizontal]:h-2',
        'aria-[orientation=horizontal]:after:inset-x-4 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-0.5 aria-[orientation=horizontal]:after:-translate-y-1/2',
        className,
      )}
      {...props}
    />
  );
}
