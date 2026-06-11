import React from 'react';
import { PortsDrawer } from './PortsDrawer';
import { usePortsState } from './usePortsState';

interface PortsDrawerWrapperProps {
  taskId: string | null;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  children: React.ReactNode;
}

/**
 * Stacks the wrapped content above the ports drawer. The drawer sizes to
 * its own content — unlike the terminal drawer, there's no benefit to a
 * resizable split since the port list is short.
 *
 * Falls through to plain children when the task has no ports declared, so
 * projects that don't use port management don't see an empty drawer. The
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

  if (!taskId || !state.hasContent) {
    return <>{children}</>;
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0">{children}</div>
      <PortsDrawer
        taskId={taskId}
        state={state}
        collapsed={collapsed}
        onCollapse={onCollapse}
        onExpand={onExpand}
      />
    </div>
  );
}
