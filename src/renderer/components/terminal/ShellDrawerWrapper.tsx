import React, { useRef, useCallback } from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  type PanelImperativeHandle,
} from '../ui/Resizable';
import { TerminalTabs } from './TerminalTabs';

interface ShellDrawerWrapperProps {
  enabled: boolean;
  taskId: string | null;
  cwd: string | null;
  collapsed: boolean;
  label?: string;
  panelRef: React.RefObject<PanelImperativeHandle | null>;
  animating: boolean;
  onAnimate: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onTuiActiveChange?: (active: boolean, canvasPx?: number) => void;
  children: React.ReactNode;
}

export function ShellDrawerWrapper({
  enabled,
  taskId,
  cwd,
  collapsed,
  label,
  panelRef,
  animating,
  onAnimate,
  onCollapse,
  onExpand,
  onTuiActiveChange,
  children,
}: ShellDrawerWrapperProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  // Grow the drawer to at least `px` tall (expanding first if collapsed) —
  // side-car TUI start screens need a minimum height to render fully.
  const ensureHeight = useCallback(
    (px: number) => {
      const total = groupRef.current?.clientHeight ?? 0;
      const panel = panelRef.current;
      if (!panel || total <= 0) return;
      const pct = Math.min(90, (px / total) * 100);
      if (panel.isCollapsed() || panel.getSize().asPercentage < pct) {
        onAnimate();
        panel.expand();
        if (panel.getSize().asPercentage < pct) panel.resize(`${pct}%`);
      }
    },
    [panelRef, onAnimate],
  );

  if (!enabled || !taskId || !cwd) {
    return <>{children}</>;
  }

  return (
    <div ref={groupRef} className="h-full">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel minSize="0%">{children}</ResizablePanel>
        {/* Stays live while collapsed so the bar can be dragged back open. */}
        <ResizableHandle />
        <ResizablePanel
          panelRef={panelRef}
          animate={animating}
          defaultSize={collapsed ? '3%' : '45%'}
          minSize="8%"
          collapsible
          collapsedSize="3%"
          onCollapse={onCollapse}
          onExpand={onExpand}
        >
          <TerminalTabs
            key={taskId}
            taskId={taskId}
            cwd={cwd}
            collapsed={collapsed}
            label={label}
            onCollapse={() => {
              onAnimate();
              panelRef.current?.collapse();
            }}
            onExpand={() => {
              onAnimate();
              panelRef.current?.expand();
            }}
            onEnsureHeight={ensureHeight}
            onTuiActiveChange={onTuiActiveChange}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
