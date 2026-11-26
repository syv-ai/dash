import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { folderStripBand } from '../ui/FolderTab';
import { useFittedDensity } from '../ui/useFittedDensity';
import { fitViewRow, type ExtraFit, type ViewRowExtraPx, type ViewRowFit } from './viewRowFit';

/** A control between the tabs and the row's end; `key` names it. */
export interface ViewRowExtra {
  key: string;
  node: ReactNode;
  /** Its compact form, where the row is tight: a 24px icon button, which the
   *  sidebar's least width always has room for (R12). Without one it hides. */
  compact?: ReactNode;
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

/** A fit as a string (Details' digit, then one per extra), so an equal fit
 *  is an equal state and doesn't re-render. */
const EXTRA_FITS: readonly ExtraFit[] = ['hidden', 'compact', 'full'];
const encode = (fit: ViewRowFit) =>
  [Number(fit.details), ...fit.extras.map((f) => EXTRA_FITS.indexOf(f))].join('');
const decode = (code: string, extras: number): ViewRowFit => ({
  details: code[0] === '1',
  extras: Array.from({ length: extras }, (_, i) => EXTRA_FITS[Number(code[i + 1])] ?? 'hidden'),
});

/** The sizer's widths (each extra, then its compact form if it has one), per
 *  extra. */
function extraWidths(extras: readonly ViewRowExtra[], widths: readonly number[]): ViewRowExtraPx[] {
  let i = 0;
  return extras.map((e) => ({
    px: widths[i++] ?? Infinity,
    compactPx: e.compact === undefined ? undefined : (widths[i++] ?? Infinity),
  }));
}

/**
 * The task sidebar's view row, on the sheet's top edge, 1px over, like the
 * editor's tab strip: the view tabs, the middle's extras, then `end`
 * (Details). Who gives way as it narrows: the tabs' counts (`ViewTabs`,
 * which shrinks first), then `end` (unless `endPressed`: it is the view
 * shown), then the extras, last first, each to its compact form and then
 * hidden (`fitViewRow`); `end` never comes back in an extra's place. The
 * tabs' inset and labels never give way, and one icon (`end`, or the first
 * extra's compact form) always fits: the sidebar is kept as wide as they
 * need (`viewRowMinPx`).
 */
export function ViewRow({
  tabs,
  tabsMinPx,
  extras,
  end,
  endPressed,
}: {
  tabs: ReactNode;
  /** The tabs' least width, as `ViewTabs` reports it. */
  tabsMinPx: number | undefined;
  /** In order of keeping: the last gives way first. */
  extras: ViewRowExtra[];
  end: ReactNode;
  /** `end` is on: it keeps its place ahead of the extras. */
  endPressed: boolean;
}) {
  const { rootRef, sizerRef, density } = useFittedDensity<string>(
    (rowWidth, needs) =>
      encode(fitViewRow(rowWidth, tabsMinPx ?? 0, extraWidths(extras, needs), endPressed)),
    // Before measuring: `end` alone.
    '1',
    `${extras.map((e) => `${e.key}${e.compact === undefined ? '' : '+'}`).join()}:${tabsMinPx}:${endPressed}`,
  );
  const shown = decode(density, extras.length);

  return (
    <div ref={rootRef} className="relative z-10 -mb-px flex h-9 shrink-0 items-center gap-0.5 pr-1">
      {tabs}
      {/* It clips across only, as a last guard: the fit keeps its extras
          whole, never under `end`. */}
      <Middle
        extras={extras.flatMap((e, i) => {
          const fit = shown.extras[i];
          if (fit === 'hidden') return [];
          return [fit === 'compact' ? { ...e, node: e.compact } : e];
        })}
        className={cn('min-w-0 flex-auto overflow-x-clip', folderStripBand)}
      />
      {shown.details && end}
      {/* Each extra alone, then its compact form, measured. */}
      <div
        ref={sizerRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        {extras.flatMap((e) => [
          <ExtraSlot key={e.key} extra={{ ...e, trailing: false }} className="w-max" />,
          e.compact !== undefined && (
            <ExtraSlot
              key={`${e.key}:compact`}
              extra={{ ...e, node: e.compact, trailing: false }}
              className="w-max"
            />
          ),
        ])}
      </div>
    </div>
  );
}
