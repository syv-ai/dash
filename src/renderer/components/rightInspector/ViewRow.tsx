import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { folderStripBand } from '../ui/FolderTab';
import { useFittedDensity } from '../ui/useFittedDensity';
import { fitViewRow, type ViewRowFit } from './viewRowFit';

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
        <ExtraSlot key={e.key} extra={e} />
      ))}
    </div>
  );
}

function ExtraSlot({ extra, className }: { extra: ViewRowExtra; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center', extra.trailing && 'ml-auto', className)}>
      {extra.node}
    </div>
  );
}

/** A fit as a string ("1" + one digit per extra), so an equal fit is an equal
 *  state and doesn't re-render. */
const encode = (fit: ViewRowFit) => [fit.details, ...fit.extras].map(Number).join('');
const decode = (code: string, extras: number): ViewRowFit => ({
  details: code[0] === '1',
  extras: Array.from({ length: extras }, (_, i) => code[i + 1] === '1'),
});

/**
 * The task sidebar's view row, on the sheet's top edge, 1px over, like the
 * editor's tab strip: the view tabs, the middle's extras, then `end`
 * (Details). Who gives way as it narrows: the tabs' counts (`FolderTabs`,
 * which shrinks first), then `end` (unless `endPressed`: it is the view
 * shown), then the extras, whole and last first (`fitViewRow`). The tabs'
 * inset and labels never do, and `end` always fits alone: the sidebar is
 * kept as wide as they need (`viewRowMinPx`).
 */
export function ViewRow({
  tabs,
  tabsMinPx,
  extras,
  end,
  endPressed,
}: {
  tabs: ReactNode;
  /** The tabs' least width, as `FolderTabs` reports it. */
  tabsMinPx: number | undefined;
  /** In order of keeping: the last gives way first. */
  extras: ViewRowExtra[];
  end: ReactNode;
  /** `end` is on: it keeps its place ahead of the extras. */
  endPressed: boolean;
}) {
  const { rootRef, sizerRef, density } = useFittedDensity<string>(
    (rowWidth, needs) => encode(fitViewRow(rowWidth, tabsMinPx ?? 0, needs, endPressed)),
    // Before measuring: `end` alone.
    '1',
    `${extras.map((e) => e.key).join()}:${tabsMinPx}:${endPressed}`,
  );
  const shown = decode(density, extras.length);

  return (
    <div ref={rootRef} className="relative z-10 -mb-px flex h-9 shrink-0 items-center gap-0.5 pr-1">
      {tabs}
      {/* It clips across only, as a last guard: the fit keeps its extras
          whole, never under `end`. */}
      <Middle
        extras={extras.filter((_, i) => shown.extras[i])}
        className={cn('min-w-0 flex-auto overflow-x-clip', folderStripBand)}
      />
      {shown.details && end}
      {/* Each extra alone, measured. */}
      <div
        ref={sizerRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        {extras.map((e) => (
          <ExtraSlot key={e.key} extra={{ ...e, trailing: false }} className="w-max" />
        ))}
      </div>
    </div>
  );
}
