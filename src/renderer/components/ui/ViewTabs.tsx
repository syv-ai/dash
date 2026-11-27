import * as React from 'react';
import { cn } from '../../lib/cn';
import { CountBadge } from './CountBadge';
import { FolderTab, folderIndicator } from './FolderTab';
import { pillIndicator, pillVariants, segmentTip } from './Segmented';
import { Tab, type TabProps } from './Tab';
import { TabIndicator } from './TabIndicator';
import { useSlideIn } from './tabMotion';
import { Tooltip } from './Tooltip';
import { firstFitting, useFittedDensity } from './useFittedDensity';
import { useReselect } from './useReselect';
import { stepTab, useWheelTabSwitch } from './useWheelTabSwitch';

/** How the row gives way as it narrows: it drops the counts (they move into
 *  the tooltip). Its labels never truncate; the host keeps it at least as
 *  wide as `uncounted` (`onMinWidth`). */
export type ViewTabsDensity = 'full' | 'uncounted';
const measured = ['full', 'uncounted'] as const;
export const fitViewTabs = (available: number, needs: readonly number[]): ViewTabsDensity =>
  firstFitting(available, needs, measured) ?? 'uncounted';

/**
 * The two looks. `folder`: case files (`FolderTab`) on the row's foot, the
 * open one joined to the sheet the host draws under the row (`folderSheet`),
 * the first inset clear of the sheet's 12px rounded corner (a tab sliding
 * onto the corner reads as a glitch, so the inset never gives way). `pill`:
 * `Segmented`'s pills (`pillVariants`), centred in the row, on no sheet.
 */
export type ViewTabsVariant = 'folder' | 'pill';

/** The selected tab's surface, sliding from tab to tab (`TabIndicator`). */
const indicator: Record<ViewTabsVariant, string> = {
  folder: folderIndicator,
  pill: pillIndicator,
};

/** Where the tabs sit in the row. */
const align: Record<ViewTabsVariant, string> = { folder: 'h-full items-end', pill: 'items-center' };
/** The room before the first tab: the folder's corner inset. */
const inset: Record<ViewTabsVariant, string> = { folder: 'pl-3', pill: '' };

/** One tab in the variant's look. */
const ViewTab = React.forwardRef<HTMLDivElement, TabProps & { variant: ViewTabsVariant }>(
  function ViewTab({ variant, active, className, ...props }, ref) {
    return variant === 'folder' ? (
      <FolderTab
        ref={ref}
        active={active}
        indicated
        className={cn('max-w-none pr-3', className)}
        {...props}
      />
    ) : (
      <Tab
        ref={ref}
        active={active}
        className={cn(
          pillVariants({ size: 'sm', selected: !!active, indicated: true }),
          'shrink-0 select-none',
          className,
        )}
        {...props}
      />
    );
  },
);

/** One view of a `ViewTabs`. */
export type ViewTabsOption<T> = {
  value: T;
  label: string;
  count?: number;
  /** What `count` counts ("Changed files"): the tooltip names it. */
  countLabel?: string;
  /** Tooltip text. */
  title?: string;
};

/** The label, with its count for screen readers while the badge is dropped. */
function Label<T>({ opt, counted }: { opt: ViewTabsOption<T>; counted: boolean }) {
  return (
    <span className="whitespace-nowrap">
      {opt.label}
      {!counted && opt.count != null && <span className="sr-only"> {opt.count}</span>}
    </span>
  );
}

/** The count's look: a folder's on the badge's fill; a pill's bare, as on
 *  the selected pill's tint a fill would sit on a fill. */
const countTone: Record<ViewTabsVariant, 'neutral' | 'bare'> = { folder: 'neutral', pill: 'bare' };

/** The count badge, only where there is one to show: an empty indicator would
 *  still take `Tab`'s gap and push the label off centre. */
function countBadge<T>(opt: ViewTabsOption<T>, counted: boolean, variant: ViewTabsVariant) {
  return counted && opt.count != null ? (
    <CountBadge count={opt.count} tone={countTone[variant]} />
  ) : undefined;
}

/**
 * A view switch: the sidebars' (Files | History | Agent; Tasks | Projects).
 * One behaviour in two looks (`variant`). None is selected while `value`
 * names no option; a double click on the selected one is `onReselect`.
 *
 * The selected surface slides from tab to tab (`TabIndicator`), and the
 * view under it slides in from the side of travel when it's wrapped in a
 * `ViewPanel`. A sideways scroll over the tabs steps to the next or previous
 * view, one per gesture (`useWheelTabSwitch`).
 *
 * Its labels always read in full. It takes its full width (counts included)
 * when the row has room and shrinks first when it hasn't, dropping the
 * counts; it never goes below its labels' width (and the folder's inset),
 * which it reports through `onMinWidth` so the host can keep that much room.
 */
export function ViewTabs<T extends string>({
  variant,
  value,
  options,
  onChange,
  onReselect,
  onMinWidth,
  className,
  'aria-label': ariaLabel,
}: {
  variant: ViewTabsVariant;
  value: T;
  options: Array<ViewTabsOption<T>>;
  onChange: (v: T) => void;
  /** A double click on the option that was already selected when the
   *  gesture began. */
  onReselect?: (v: T) => void;
  /** The row's least width (its labels, and the folder's inset; no counts),
   *  in px, once measured. */
  onMinWidth?: (px: number) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const { rootRef, sizerRef, density, needs } = useFittedDensity<ViewTabsDensity>(
    fitViewTabs,
    'full',
    options.length,
  );
  const [fullNeed, minNeed] = needs;
  const counted = density !== 'uncounted';
  React.useEffect(() => {
    if (minNeed !== undefined) onMinWidth?.(minNeed);
  }, [minNeed, onMinWidth]);
  const reselect = useReselect(value, onReselect);
  useWheelTabSwitch(rootRef, (step) => {
    const next = stepTab(
      options.map((o) => o.value),
      value,
      step,
    );
    if (next !== undefined) onChange(next);
  });

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('relative flex gap-0.5', align[variant], inset[variant], className)}
      // Shrinks ahead of the row's other items (by far the largest factor),
      // from its full width down to its labels'.
      style={{ flexBasis: fullNeed, flexShrink: 1000, flexGrow: 0, minWidth: minNeed }}
    >
      <TabIndicator active={value} className={indicator[variant]} />
      {options.map((opt) => {
        const tip = segmentTip(opt, counted);
        return (
          <Tooltip key={opt.value} content={tip}>
            <ViewTab
              variant={variant}
              active={opt.value === value}
              onSelect={() => onChange(opt.value)}
              indicator={countBadge(opt, counted, variant)}
              {...reselect(opt.value)}
            >
              <Label opt={opt} counted={counted} />
            </ViewTab>
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
          <div key={d} className={cn('flex w-max gap-0.5', inset[variant])}>
            {options.map((opt) => (
              <ViewTab
                key={opt.value}
                variant={variant}
                // A tab measures the same selected or not (its bold label's
                // width is held, a closed folder keeps the outline's sides),
                // so none is: switching never re-fits the row.
                active={false}
                tabIndex={-1}
                role="presentation"
                onSelect={() => {}}
                indicator={countBadge(opt, d !== 'uncounted', variant)}
              >
                <Label opt={opt} counted={d !== 'uncounted'} />
              </ViewTab>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The view a `ViewTabs` shows: when `value` changes to another of `order`
 * (the tabs' values, in their order), it slides in a short way from the side
 * of travel and fades in (`useSlideIn`); its content stays mounted. A host
 * whose views sit in a clipping box (a sheet) clips the slide.
 */
export function ViewPanel<T extends string>({
  value,
  order,
  className,
  children,
}: {
  value: T;
  order: readonly T[];
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useSlideIn(ref, value, order);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
