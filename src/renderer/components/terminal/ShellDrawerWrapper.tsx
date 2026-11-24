import {
  useRef,
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  type PanelImperativeHandle,
} from '../ui/Resizable';
import { TerminalTabs } from './TerminalTabs';
import { cn } from '../../lib/cn';

interface ShellDrawerWrapperProps {
  taskId: string;
  cwd: string;
  collapsed: boolean;
  label?: string;
  /** The terminal palette's background, for the drawer's sheet. */
  terminalBg?: string;
  panelRef: RefObject<PanelImperativeHandle | null>;
  animating: boolean;
  onAnimate: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onTuiActiveChange?: (active: boolean, canvasPx?: number) => void;
  children: ReactNode;
}

/** The drawer's height when collapsed: the 8px gap above its sheet plus the
 *  tab bar. Pixels, so it doesn't drift with the window height. */
const COLLAPSED_PX = 44;
const MIN_PX = 120;
const EXPANDED_DEFAULT = '40%';

/**
 * The task sidebar's vertical split: `children` on top, the task's terminals
 * below on their own sheet, resizable and collapsible down to the tab bar.
 * The split persists.
 */
export function ShellDrawerWrapper({
  taskId,
  cwd,
  collapsed,
  label,
  terminalBg,
  panelRef,
  animating,
  onAnimate,
  onCollapse,
  onExpand,
  onTuiActiveChange,
  children,
}: ShellDrawerWrapperProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  // The default size follows the collapsed state at mount only: a changing
  // defaultSize re-registers the panel, which forgets the size to expand to.
  const [startedCollapsed] = useState(collapsed);

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

  return (
    <div ref={groupRef} className="h-full">
      <ResizablePanelGroup orientation="vertical" autoSaveId="task-terminal">
        <ResizablePanel id="task-content" minSize="15%">
          {children}
        </ResizablePanel>
        {/* Stays live while collapsed so the bar can be dragged back open. */}
        <ResizableHandle />
        <ResizablePanel
          id="task-terminal"
          panelRef={panelRef}
          animate={animating}
          defaultSize={startedCollapsed ? COLLAPSED_PX : EXPANDED_DEFAULT}
          minSize={MIN_PX}
          collapsible
          collapsedSize={COLLAPSED_PX}
          onCollapse={onCollapse}
          onExpand={onExpand}
        >
          <div className="h-full pt-2">
            <div
              className={cn(
                'h-full overflow-hidden rounded-xl border border-line',
                terminalBg ? 'bg-(--sheet-bg)' : 'bg-well',
              )}
              style={{ '--sheet-bg': terminalBg } as CSSProperties}
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
                  const panel = panelRef.current;
                  if (!panel) return;
                  onAnimate();
                  panel.expand();
                  // Collapsed since launch, it has no size to go back to.
                  if (panel.getSize().inPixels <= MIN_PX) panel.resize(EXPANDED_DEFAULT);
                }}
                onEnsureHeight={ensureHeight}
                onTuiActiveChange={onTuiActiveChange}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
