import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { panelEaseMs, type PanelImperativeHandle, type PanelSize } from '../ui/Resizable';
import { heldAcrossRail, type Held } from '../../lib/railCrossing';
import { useEditorTabs } from '../../stores/editorTabsStore';

/*
 * The editor's file tree column folds away and back, from a toggle at the
 * start of the editor's tab strip. The fold is remembered (one flag for every
 * editor, in editorTabsStore); dragging the column shut sets it too.
 */

/** Props for the `ResizablePanel` holding the tree: collapsible to
 *  `collapsedSize` (px; the host's rail), easing when the toggle drives it,
 *  and kept in step with the remembered flag. `held`: its content's hold
 *  while it crosses to or from the rail, toggled or dragged (`ui/HeldFrame`;
 *  dragged out of the rail, the panel's own `dragOpen` settles it),
 *  at its open width; `railed`: it shows its rail. */
export function useTreePanel(collapsedSize: number) {
  const collapsed = useEditorTabs((s) => s.treeCollapsed);
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const [animate, setAnimate] = useState(false);
  // At mount the panel takes the flag without easing.
  const [startCollapsed] = useState(collapsed);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || panel.isCollapsed() === collapsed) return;
    setAnimate(true);
    // Let the ease attribute land before the size changes.
    const frame = requestAnimationFrame(() => (collapsed ? panel.collapse() : panel.expand()));
    const done = window.setTimeout(() => setAnimate(false), panelEaseMs() + 20);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(done);
    };
  }, [collapsed]);

  // The open width (px) and the split's (px), as the panel last reported
  // them; `folded` as of the last crossing (null before the first, the
  // mount's own, which holds nothing).
  const [held, setHeld] = useState<Held | null>(null);
  // Folded as the panel is, not as the flag asks: the flag leads the panel by
  // a frame or two (the toggle, the rail's click), and content unhidden on
  // the flag showed squeezed into the rail's width before its hold landed.
  // This turns over with the hold, in one render.
  const [folded, setFolded] = useState(collapsed);
  const extent = useRef<{ openPx: number; groupPx: number; folded: boolean | null }>({
    openPx: 0,
    groupPx: 0,
    folded: null,
  });
  const heldTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(heldTimer.current), []);
  const cross = (folded: boolean) => {
    setFolded(folded);
    const was = extent.current.folded;
    extent.current.folded = folded;
    if (was === null || panelEaseMs() === 0) return;
    const { openPx, groupPx } = extent.current;
    // Where it is heading, from the layout (the DOM is still easing).
    const pct = panelRef.current?.getSize().asPercentage ?? 0;
    const next = heldAcrossRail(
      { px: was ? collapsedSize : openPx, collapsed: was },
      { px: (pct / 100) * groupPx, collapsed: folded },
    );
    if (!next) return;
    setHeld(next);
    window.clearTimeout(heldTimer.current);
    heldTimer.current = window.setTimeout(() => setHeld(null), panelEaseMs());
  };
  const onResize = (size: PanelSize) => {
    if (size.asPercentage > 0) extent.current.groupPx = (size.inPixels * 100) / size.asPercentage;
    // Folding, the layout is collapsed from the first frame: the width kept
    // is the one it had open.
    if (panelRef.current?.isCollapsed() === false) extent.current.openPx = size.inPixels;
  };

  const set = (next: boolean) => useEditorTabs.getState().setTreeCollapsed(next);
  return {
    held,
    // Its rail shows once it has folded and until it unfolds.
    railed: folded && !held,
    panelRef,
    animate,
    collapsible: true,
    collapsedSize,
    // Its handle drags it out of the rail too (X2).
    dragOpen: true,
    ...(startCollapsed ? { defaultSize: collapsedSize } : {}),
    onResize,
    onCollapse: () => {
      cross(true);
      set(true);
    },
    onExpand: () => {
      cross(false);
      set(false);
    },
  };
}

/** Shows or hides the file tree column. */
export function TreeToggle() {
  const collapsed = useEditorTabs((s) => s.treeCollapsed);
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <IconButton
      size="sm"
      title={collapsed ? 'Show files' : 'Hide files'}
      aria-pressed={!collapsed}
      onClick={() => useEditorTabs.getState().setTreeCollapsed(!collapsed)}
    >
      <Icon size={14} strokeWidth={1.8} />
    </IconButton>
  );
}
