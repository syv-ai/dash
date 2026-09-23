import React from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { TerminalTabs } from './TerminalTabs';

interface ShellDrawerWrapperProps {
  enabled: boolean;
  taskId: string | null;
  cwd: string | null;
  collapsed: boolean;
  label?: string;
  panelRef: React.RefObject<ImperativePanelHandle | null>;
  animating: boolean;
  onAnimate: () => void;
  onCollapse: () => void;
  onExpand: () => void;
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
  children,
}: ShellDrawerWrapperProps) {
  if (!enabled || !taskId || !cwd) {
    return <>{children}</>;
  }

  return (
    <div className="h-full">
      <PanelGroup direction="vertical" className="h-full">
        <Panel minSize={0}>{children}</Panel>
        {/* Stays live while collapsed so the bar can be dragged back open. */}
        <PanelResizeHandle className="h-px bg-transparent" />
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
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
