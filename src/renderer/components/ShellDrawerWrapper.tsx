import React, { useRef, useCallback } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { TerminalDrawer } from './TerminalDrawer';

interface ShellDrawerWrapperProps {
  enabled: boolean;
  taskId: string | null;
  cwd: string | null;
  collapsed: boolean;
  label?: string;
  panelRef: React.RefObject<ImperativePanelHandle>;
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
      if (panel.isCollapsed() || panel.getSize() < pct) {
        onAnimate();
        panel.expand();
        if (panel.getSize() < pct) panel.resize(pct);
      }
    },
    [panelRef, onAnimate],
  );

  if (!enabled || !taskId || !cwd) {
    return <>{children}</>;
  }

  return (
    <div ref={groupRef} className="h-full">
      <PanelGroup direction="vertical" className="h-full">
        <Panel minSize={0}>{children}</Panel>
        <PanelResizeHandle disabled={collapsed} className="h-[1px] bg-transparent" />
        <Panel
          ref={panelRef}
          className={animating ? 'panel-transition' : ''}
          defaultSize={collapsed ? 3 : 45}
          minSize={8}
          collapsible
          collapsedSize={3}
          onCollapse={onCollapse}
          onExpand={onExpand}
        >
          <TerminalDrawer
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
        </Panel>
      </PanelGroup>
    </div>
  );
}
