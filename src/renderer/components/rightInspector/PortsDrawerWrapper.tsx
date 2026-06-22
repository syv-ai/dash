import React, { useRef, useState } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { PortsDrawer } from './PortsDrawer';
import { usePortsState } from './usePortsState';

interface PortsDrawerWrapperProps {
  taskId: string | null;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  children: React.ReactNode;
}

/** Panel height (% of the split) when the Services list is collapsed — the
 *  header bar fills this. Tuned to roughly match the terminal drawer's bar. */
const COLLAPSED_SIZE = 5;

/**
 * Splits the right inspector into a resizable vertical stack: the wrapped
 * content (git changes) on top, the Services drawer below, with a drag handle
 * between them. Mirrors the terminal drawer — a real collapsible `Panel` whose
 * size persists (via `autoSaveId`) and whose collapse/expand is driven
 * imperatively through `panelRef`.
 *
 * Falls through to plain children when the task has no ports declared, so
 * projects that don't use service management don't see an empty drawer. The
 * pre-setup affordance lives in a separate toast (see usePortsOnboarding).
 */
export function PortsDrawerWrapper({
  taskId,
  collapsed,
  onCollapse,
  onExpand,
  children,
}: PortsDrawerWrapperProps) {
  const state = usePortsState(taskId);
  const panelRef = useRef<ImperativePanelHandle>(null);
  const [animating, setAnimating] = useState(false);

  if (!taskId || !state.hasContent) {
    return <>{children}</>;
  }

  return (
    <PanelGroup direction="vertical" autoSaveId="ports-split" className="h-full">
      <Panel id="ports-content" order={1} minSize={0} className="min-h-0">
        {children}
      </Panel>
      {/* Stays live while collapsed so the bar can be dragged back open. */}
      <PanelResizeHandle className="h-[1px] bg-transparent" />
      <Panel
        id="ports-list"
        order={2}
        ref={panelRef}
        className={animating ? 'panel-transition' : ''}
        defaultSize={collapsed ? COLLAPSED_SIZE : 32}
        minSize={14}
        collapsible
        collapsedSize={COLLAPSED_SIZE}
        onCollapse={() => {
          onCollapse();
          setTimeout(() => setAnimating(false), 200);
        }}
        onExpand={() => {
          onExpand();
          setTimeout(() => setAnimating(false), 200);
        }}
      >
        <PortsDrawer
          taskId={taskId}
          state={state}
          collapsed={collapsed}
          onCollapse={() => {
            setAnimating(true);
            panelRef.current?.collapse();
          }}
          onExpand={() => {
            setAnimating(true);
            panelRef.current?.expand();
          }}
        />
      </Panel>
    </PanelGroup>
  );
}
