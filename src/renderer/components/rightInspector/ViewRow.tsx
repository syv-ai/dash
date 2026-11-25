import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { folderStripBand } from '../ui/FolderTab';
import { useFittedDensity } from '../ui/useFittedDensity';
import { fitExtras, VIEW_ROW_END_PX } from './viewRowFit';

/** A control between the tabs and the row's end; `key` names it. */
export interface ViewRowExtra {
  key: string;
  node: ReactNode;
  /** Pushed to the middle's end, beside `end`. */
  trailing?: boolean;
}

/** The middle with these extras, on the labels' line. */
function Middle({ extras, className }: { extras: ViewRowExtra[]; className?: string }) {
  return (
    <div className={cn('flex items-center gap-0.5 px-1', className)}>
      {extras.map((e) => (
        <div key={e.key} className={cn('flex shrink-0 items-center', e.trailing && 'ml-auto')}>
          {e.node}
        </div>
      ))}
    </div>
  );
}

/**
 * The task sidebar's view row, on the sheet's top edge, 1px over, like the
 * editor's tab strip: the view tabs, the middle's extras, then `end`
 * (Details). Who gives way as it narrows: the tabs' inset off the sheet's
 * corner, then their counts (`FolderTabs`, which shrinks first), then the
 * extras, whole and last first. The tabs' labels and `end` never do: the
 * sidebar is kept as wide as they need (`viewRowMinPx`).
 */
export function ViewRow({
  tabs,
  tabsMinPx,
  extras,
  end,
}: {
  tabs: ReactNode;
  /** The tabs' least width, as `FolderTabs` reports it. */
  tabsMinPx: number | undefined;
  /** In order of keeping: the last gives way first. */
  extras: ViewRowExtra[];
  end: ReactNode;
}) {
  const {
    rootRef,
    sizerRef,
    density: shown,
  } = useFittedDensity<number>(
    (rowWidth, needs) => fitExtras(rowWidth - (tabsMinPx ?? 0) - VIEW_ROW_END_PX, needs),
    0,
    `${extras.map((e) => e.key).join()}:${tabsMinPx}`,
  );

  return (
    <div ref={rootRef} className="relative z-10 -mb-px flex h-9 shrink-0 items-center gap-0.5 pr-1">
      {tabs}
      {/* It clips across only, as a last guard: the fit keeps its extras
          whole, never under `end`. */}
      <Middle
        extras={extras.slice(0, shown)}
        className={cn('min-w-0 flex-auto overflow-x-clip', folderStripBand)}
      />
      {end}
      {/* The middle with each number of extras, most first, measured. */}
      <div
        ref={sizerRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        {extras.map((_, i) => (
          <Middle key={i} extras={extras.slice(0, extras.length - i)} className="w-max" />
        ))}
      </div>
    </div>
  );
}
