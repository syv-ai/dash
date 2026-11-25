import * as React from 'react';
import { cn } from '../../lib/cn';
import { CountBadge } from './CountBadge';
import { FolderTab } from './FolderTab';
import { segmentTip } from './Segmented';
import { Tooltip } from './Tooltip';
import { firstFitting, useFittedDensity } from './useFittedDensity';
import { useReselect } from './useReselect';

/** How the row gives way as it narrows: it gives up the inset that keeps its
 *  first tab off the sheet's rounded corner, then drops the counts (they move
 *  into the tooltip). Its labels never truncate; the host keeps it at least
 *  as wide as `uncounted` (`onMinWidth`). */
export type FolderTabsDensity = 'full' | 'flush' | 'uncounted';
const measured = ['full', 'flush', 'uncounted'] as const;
export const fitFolderTabs = (available: number, needs: readonly number[]): FolderTabsDensity =>
  firstFitting(available, needs, measured) ?? 'uncounted';

/** The inset off the sheet's 12px corner, while the row has room for it. */
const inset = (d: FolderTabsDensity) => (d === 'full' ? 'pl-3' : '');

type Option<T> = {
  value: T;
  label: string;
  count?: number;
  /** What `count` counts ("Changed files"): the tooltip names it. */
  countLabel?: string;
  /** Tooltip text. */
  title?: string;
};

/** The label, with its count for screen readers while the badge is dropped. */
function Label<T>({ opt, counted }: { opt: Option<T>; counted: boolean }) {
  return (
    <span className="whitespace-nowrap">
      {opt.label}
      {!counted && opt.count != null && <span className="sr-only"> {opt.count}</span>}
    </span>
  );
}

/** The count badge, only where there is one to show: an empty indicator would
 *  still take `Tab`'s gap and push the label off centre. */
function countBadge<T>(opt: Option<T>, counted: boolean) {
  return counted && opt.count != null ? <CountBadge count={opt.count} /> : undefined;
}

/**
 * A view switch drawn as a stack of case files (`FolderTab`): the picked view
 * is the open folder, joined to the sheet below it, which the host draws
 * (`folderSheet`) right under the row, as the editor's tabs sit on its
 * sheet. None is open while `value` names no option.
 *
 * Its labels always read in full. It takes its full width (its first tab
 * inset clear of the sheet's rounded corner, counts included) when the row
 * has room and shrinks first when it hasn't, giving up the inset, then the
 * counts; it never goes below its labels' width, which it reports through
 * `onMinWidth` so the host can keep that much room.
 */
export function FolderTabs<T extends string>({
  value,
  options,
  onChange,
  onReselect,
  onMinWidth,
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  options: Array<Option<T>>;
  onChange: (v: T) => void;
  /** A double click on the option that was already open when the gesture
   *  began. */
  onReselect?: (v: T) => void;
  /** The row's least width (its labels, no inset or counts), in px, once
   *  measured. */
  onMinWidth?: (px: number) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const { rootRef, sizerRef, density, needs } = useFittedDensity<FolderTabsDensity>(
    fitFolderTabs,
    'full',
    options.length,
  );
  const [fullNeed, , minNeed] = needs;
  const counted = density !== 'uncounted';
  React.useEffect(() => {
    if (minNeed !== undefined) onMinWidth?.(minNeed);
  }, [minNeed, onMinWidth]);
  const reselect = useReselect(value, onReselect);

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('relative flex h-full items-end gap-0.5', inset(density), className)}
      // Shrinks ahead of the row's other items (by far the largest factor),
      // from its full width down to its labels'.
      style={{ flexBasis: fullNeed, flexShrink: 1000, flexGrow: 0, minWidth: minNeed }}
    >
      {options.map((opt) => {
        const tip = segmentTip(opt, counted);
        return (
          <Tooltip key={opt.value} content={tip}>
            <FolderTab
              active={opt.value === value}
              onSelect={() => onChange(opt.value)}
              indicator={countBadge(opt, counted)}
              className="max-w-none pr-3"
              {...reselect(opt.value)}
            >
              <Label opt={opt} counted={counted} />
            </FolderTab>
          </Tooltip>
        );
      })}
      {/* The row at each density, measured. */}
      <div
        ref={sizerRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        {measured.map((d) => (
          <div key={d} className={cn('flex w-max gap-0.5', inset(d))}>
            {options.map((opt) => (
              <FolderTab
                key={opt.value}
                // The open folder is outlined, 2px wider: measured as shown.
                active={opt.value === value}
                tabIndex={-1}
                role="presentation"
                onSelect={() => {}}
                indicator={countBadge(opt, d !== 'uncounted')}
                className="max-w-none pr-3"
              >
                <Label opt={opt} counted={d !== 'uncounted'} />
              </FolderTab>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
