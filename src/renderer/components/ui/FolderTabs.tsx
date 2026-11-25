import * as React from 'react';
import { cn } from '../../lib/cn';
import { CountBadge } from './CountBadge';
import { FolderTab } from './FolderTab';
import { segmentTip } from './Segmented';
import { Tooltip } from './Tooltip';
import { firstFitting, useFittedDensity } from './useFittedDensity';
import { useReselect } from './useReselect';

/** How the row gives way as it narrows: it drops the counts (they move into
 *  the tooltip). Its labels never truncate; the host keeps it at least as
 *  wide as `uncounted` (`onMinWidth`). */
type Density = 'full' | 'uncounted';
const measured = ['full', 'uncounted'] as const;
const fit = (available: number, needs: readonly number[]): Density =>
  firstFitting(available, needs, measured) ?? 'uncounted';

type Option<T> = {
  value: T;
  label: string;
  count?: number;
  /** Tooltip text. */
  title?: string;
};

function Label<T>({ opt }: { opt: Option<T> }) {
  return <span className="whitespace-nowrap">{opt.label}</span>;
}

function Count<T>({ opt, shown }: { opt: Option<T>; shown: boolean }) {
  if (opt.count == null) return null;
  return shown ? <CountBadge count={opt.count} /> : <span className="sr-only">{opt.count}</span>;
}

/**
 * A view switch drawn as a stack of case files (`FolderTab`): the picked view
 * is the open folder, joined to the sheet below it, which the host draws
 * (`folderSheet`) right under the row, as the editor's tabs sit on its
 * sheet. None is open while `value` names no option.
 *
 * Its labels always read in full. It takes its full width (counts included)
 * when the row has room and shrinks first when it hasn't, dropping the
 * counts; it never goes below its labels' width, which it reports through
 * `onMinWidth` so the host can keep that much room. Its first tab keeps clear
 * of the sheet's rounded corner.
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
  /** The row's least width (its labels, no counts), in px, once measured. */
  onMinWidth?: (px: number) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const { rootRef, sizerRef, density, needs } = useFittedDensity<Density>(
    fit,
    'full',
    options.length,
  );
  const [fullNeed, minNeed] = needs;
  React.useEffect(() => {
    if (minNeed !== undefined) onMinWidth?.(minNeed);
  }, [minNeed, onMinWidth]);
  const reselect = useReselect(value, onReselect);

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('relative flex h-full items-end gap-0.5', className)}
      // Shrinks ahead of the row's other items (by far the largest factor),
      // from its full width down to its labels'.
      style={{ flexBasis: fullNeed, flexShrink: 1000, flexGrow: 0, minWidth: minNeed }}
    >
      {options.map((opt) => {
        const tip = segmentTip(opt, density === 'full');
        return (
          <Tooltip key={opt.value} content={tip} open={tip ? undefined : false}>
            <FolderTab
              active={opt.value === value}
              onSelect={() => onChange(opt.value)}
              indicator={<Count opt={opt} shown={density === 'full'} />}
              className="max-w-none pr-3"
              {...reselect(opt.value)}
            >
              <Label opt={opt} />
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
          <div key={d} className="flex w-max gap-0.5">
            {options.map((opt) => (
              <FolderTab
                key={opt.value}
                // The open folder is outlined, 2px wider: measured as shown.
                active={opt.value === value}
                tabIndex={-1}
                role="presentation"
                onSelect={() => {}}
                indicator={<Count opt={opt} shown={d === 'full'} />}
                className="max-w-none pr-3"
              >
                <Label opt={opt} />
              </FolderTab>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
