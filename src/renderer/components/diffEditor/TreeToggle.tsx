import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { panelEaseMs, type PanelImperativeHandle } from '../ui/Resizable';
import { useEditorTabs } from '../../stores/editorTabsStore';

/*
 * The editor's file tree column folds away to nothing and back, from a toggle
 * at the start of the editor's tab strip. The fold is remembered (one flag for
 * every editor, in editorTabsStore); dragging the column shut sets it too.
 */

/** Props for the `ResizablePanel` holding the tree: collapsible to 0, easing
 *  when the toggle drives it, and kept in step with the remembered flag. */
export function useTreePanel() {
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

  const set = (next: boolean) => useEditorTabs.getState().setTreeCollapsed(next);
  return {
    panelRef,
    animate,
    collapsible: true,
    collapsedSize: 0,
    ...(startCollapsed ? { defaultSize: 0 } : {}),
    onCollapse: () => set(true),
    onExpand: () => set(false),
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
