import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Drawer } from '@shared/addon-api';
import { AddonBlocks, AddonHeaderActions, AddonSurfaceError, type RunAction } from './AddonBlocks';

interface AddonDrawerProps {
  /** Shown when the drawer surface failed and there is no title to show. */
  fallbackTitle: string;
  drawer?: Drawer;
  error?: string;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onAction: RunAction;
}

/** One add-on's collapsible drawer: a header bar and, when open, its blocks. */
export function AddonDrawer({
  fallbackTitle,
  drawer,
  error,
  collapsed,
  onCollapse,
  onExpand,
  onAction,
}: AddonDrawerProps) {
  const title = drawer?.title ?? fallbackTitle;
  const summary = drawer?.summary;

  return (
    <div className="flex flex-col h-full ports-drawer-enter">
      {collapsed ? (
        <button
          onClick={onExpand}
          className="h-full w-full flex items-center gap-2 px-4 text-fg-fade-80 hover:text-foreground transition-colors border-t border-edge/8 hover:bg-edge/4"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{title}</span>
          {summary && (
            <span className="text-[10.5px] tabular-nums text-muted-fade-80">{summary}</span>
          )}
          <ChevronUp size={12} strokeWidth={1.8} className="ml-auto" />
        </button>
      ) : (
        <div className="flex items-center h-10 shrink-0 border-t border-edge/8">
          <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
            {title}
          </span>
          {summary && (
            <span className="ml-2 text-[10.5px] tabular-nums text-muted-fade-80">{summary}</span>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 mr-1">
            {drawer?.actions && drawer.actions.length > 0 && (
              <AddonHeaderActions actions={drawer.actions} onAction={onAction} />
            )}
            <button
              onClick={onCollapse}
              aria-label={`Collapse ${title}`}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ChevronDown size={12} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
      {!collapsed && (
        <div
          className="flex-1 min-h-0 overflow-y-auto px-3 py-2"
          style={{ scrollbarGutter: 'stable' }}
        >
          {error ? (
            <AddonSurfaceError message={error} />
          ) : drawer ? (
            <AddonBlocks blocks={drawer.blocks} onAction={onAction} />
          ) : null}
        </div>
      )}
    </div>
  );
}
