import React, { useMemo, useRef, useState } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { useAddons } from '../../stores/addonsStore';
import { useSettings } from '../../stores/settingsStore';
import { AddonDrawer } from './AddonDrawer';
import type { AddonListItem, AddonSurfaceSet } from '@shared/addons';

/** Panel height (% of the split) of a collapsed drawer: the header bar fills it. */
const COLLAPSED_SIZE = 5;

interface DockedDrawer {
  item: AddonListItem;
  surfaces: AddonSurfaceSet;
}

/**
 * Stacks the add-on drawers placed on `side` under `children`, each in its own
 * collapsible, resizable panel (the pattern the ports drawer used). Drawers are
 * optional: with none to show — no add-on has a drawer here, or every drawer
 * returned null for this task — it renders just `children`.
 */
export function AddonDock({
  side,
  taskId,
  className = '',
  children,
}: {
  side: 'left' | 'right';
  taskId: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const sides = useSettings((s) => s.addonDrawerSide);
  const list = useAddons((s) => s.list);
  const surfacesTaskId = useAddons((s) => s.taskId);
  const taskSurfaces = useAddons((s) => s.taskSurfaces);
  const drawers = useMemo((): DockedDrawer[] => {
    if (!taskId || surfacesTaskId !== taskId) return [];
    const out: DockedDrawer[] = [];
    for (const item of list) {
      if (!item.hasDrawer || (sides[item.id] ?? item.drawerSide) !== side) continue;
      const surfaces = taskSurfaces.find((x) => x.addonId === item.id);
      if (surfaces && (surfaces.drawer || surfaces.drawerError)) out.push({ item, surfaces });
    }
    return out;
  }, [taskId, surfacesTaskId, list, taskSurfaces, sides, side]);

  if (drawers.length === 0) {
    return <div className={`flex flex-col min-h-0 ${className}`}>{children}</div>;
  }

  const ids = drawers.map((d) => d.item.id);
  return (
    <PanelGroup
      direction="vertical"
      autoSaveId={`addon-dock:${side}:${ids.join(',')}`}
      className={className}
    >
      <Panel
        id={`addon-dock-content-${side}`}
        order={0}
        minSize={0}
        className="min-h-0 flex flex-col"
      >
        {children}
      </Panel>
      {drawers.map((d, i) => (
        <DrawerPanel key={d.item.id} order={i + 1} docked={d} taskId={taskId!} />
      ))}
    </PanelGroup>
  );
}

function DrawerPanel({
  docked,
  order,
  taskId,
}: {
  docked: DockedDrawer;
  order: number;
  taskId: string;
}) {
  const { item, surfaces } = docked;
  const collapsed = useSettings((s) => s.addonDrawerCollapsed[item.id] ?? false);
  const setCollapsedMap = useSettings((s) => s.setAddonDrawerCollapsed);
  const action = useAddons((s) => s.action);
  const panelRef = useRef<ImperativePanelHandle>(null);
  const [animating, setAnimating] = useState(false);

  const setCollapsed = (value: boolean) => {
    const current = useSettings.getState().addonDrawerCollapsed;
    setCollapsedMap({ ...current, [item.id]: value });
  };

  return (
    <>
      {/* Stays live while collapsed so the bar can be dragged back open. */}
      <PanelResizeHandle className="h-px bg-transparent" />
      <Panel
        id={`addon-drawer-${item.id}`}
        order={order}
        ref={panelRef}
        className={animating ? 'panel-transition' : ''}
        defaultSize={collapsed ? COLLAPSED_SIZE : 32}
        minSize={14}
        collapsible
        collapsedSize={COLLAPSED_SIZE}
        onCollapse={() => {
          setCollapsed(true);
          setTimeout(() => setAnimating(false), 200);
        }}
        onExpand={() => {
          setCollapsed(false);
          setTimeout(() => setAnimating(false), 200);
        }}
      >
        <AddonDrawer
          fallbackTitle={item.name}
          drawer={surfaces.drawer}
          error={surfaces.drawerError}
          collapsed={collapsed}
          onCollapse={() => {
            setAnimating(true);
            panelRef.current?.collapse();
          }}
          onExpand={() => {
            setAnimating(true);
            panelRef.current?.expand();
          }}
          onAction={(actionId) => action(item.id, { surface: 'drawer', taskId }, actionId)}
        />
      </Panel>
    </>
  );
}
