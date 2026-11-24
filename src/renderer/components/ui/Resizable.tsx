import { useCallback, useRef } from 'react';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type GroupProps,
  type PanelImperativeHandle,
  type PanelProps,
  type SeparatorProps,
} from 'react-resizable-panels';
import { cn } from '../../lib/cn';

export type { PanelImperativeHandle };

/** How long an animated panel eases (see `[data-animating]` in index.css,
 *  which must match). */
export const PANEL_EASE_MS = 280;

/** The ease's length now: 0 when the user prefers reduced motion (the CSS
 *  drops the transition then too). Clear an `animate` flag after this. */
export function panelEaseMs(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : PANEL_EASE_MS;
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

interface ResizablePanelProps extends PanelProps {
  /** Ease size changes (collapse, expand, imperative resize) while true. */
  animate?: boolean;
  /** Called when the panel becomes collapsed, including on mount. */
  onCollapse?: () => void;
  /** Called when the panel stops being collapsed, including on mount. */
  onExpand?: () => void;
}

export function ResizablePanel({
  animate = false,
  onCollapse,
  onExpand,
  onResize,
  panelRef,
  ...props
}: ResizablePanelProps) {
  const handle = useRef<PanelImperativeHandle | null>(null);
  const wasCollapsed = useRef<boolean | null>(null);

  const setHandle = useCallback(
    (h: PanelImperativeHandle | null) => {
      handle.current = h;
      if (typeof panelRef === 'function') panelRef(h);
      else if (panelRef) panelRef.current = h;
    },
    [panelRef],
  );

  const handleResize: PanelProps['onResize'] = (size, id, prev) => {
    onResize?.(size, id, prev);
    if (!handle.current) return;
    const collapsed = handle.current.isCollapsed();
    if (collapsed === wasCollapsed.current) return;
    wasCollapsed.current = collapsed;
    (collapsed ? onCollapse : onExpand)?.();
  };

  return (
    <Panel
      data-slot="resizable-panel"
      data-animating={animate || undefined}
      panelRef={setHandle}
      onResize={handleResize}
      {...props}
    />
  );
}

/**
 * An invisible 8px hit area straddling the panel edge (it takes no layout
 * space); a 2px hairline shows on hover, focus and drag.
 */
export function ResizableHandle({ className, ...props }: SeparatorProps) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        'relative z-10 shrink-0 outline-none',
        'after:absolute after:rounded-full after:bg-transparent after:transition-colors after:delay-100',
        'data-[separator=hover]:after:bg-ink-3 data-[separator=active]:after:bg-ink-3 data-[separator=focus]:after:bg-ink-3',
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
