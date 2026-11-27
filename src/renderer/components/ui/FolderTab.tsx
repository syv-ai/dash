import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tab, type TabProps } from './Tab';
import { TabIndicator } from './TabIndicator';

/**
 * The sheet's surface: the terminal palette's background when the host sets
 * `--sheet-bg` (as every sheet does), else the well. A folder tab and the
 * sheet it opens into must share it exactly.
 */
export const sheetSurface = 'bg-(--sheet-bg,var(--color-well))';

/** The sheet a strip of folder tabs opens into: the strip lays its tabs on
 *  the sheet's top edge, 1px over, and keeps them off its 12px corners. */
export const folderSheet = cn('overflow-hidden rounded-xl border border-line', sheetSurface);

/** A closed folder's box: 28px tall, 1px off the strip's foot. */
const closedBand = 'mb-px h-7';

/** Where a strip's other controls (the editor's close, the sidebar's Details)
 *  sit: a closed folder's box, so their centre line is the labels'. */
export const folderStripBand = cn('self-end', closedBand);

/** A wrapper that puts one such control there. */
export const folderStripSlot = cn('flex shrink-0 items-center', folderStripBand);

const folderTabVariants = cva(
  cn(
    'group/tab relative flex min-w-11 max-w-48 shrink-0 cursor-pointer items-center justify-center rounded-t-lg pr-4 pl-3 select-none',
    'transition-[translate,background-color,color]',
    focusRing,
    // Inset, so the strip's scroll clip can't cut it.
    'focus-visible:-outline-offset-2',
  ),
  {
    variants: {
      // The open folder: on the sheet's surface, outlined on three sides, its
      // open bottom laid over the sheet's top edge (the strip overlaps the
      // sheet by 1px). The rest sit behind on the chrome, and lift on hover;
      // their sides keep the outline's 1px, clear, so a folder is as wide
      // open as closed and opening one never moves the tabs beside it.
      active: {
        true: 'z-10 h-8 border border-b-0 text-ink',
        false: cn(
          closedBand,
          'border-x border-transparent text-ink-2 hover:-translate-y-px hover:bg-hover hover:text-ink',
        ),
      },
      // The open folder of a stack that isn't focused: still open, quieter.
      muted: { true: '', false: '' },
      // The open folder's shape is the strip's sliding `TabIndicator`
      // (`folderIndicator`); the tab keeps its box (the outline's 1px
      // included, clear) so it measures the same.
      indicated: { true: '', false: '' },
    },
    compoundVariants: [
      { active: true, muted: true, className: 'text-ink-2' },
      { active: true, indicated: false, className: cn('border-line', sheetSurface) },
      { active: true, indicated: true, className: 'border-transparent' },
    ],
    defaultVariants: { active: false, muted: false, indicated: false },
  },
);

/** The open folder's shape as a sliding `TabIndicator`: on the sheet's
 *  surface, outlined on three sides, its open bottom over the sheet's edge. */
export const folderIndicator = cn('rounded-t-lg border border-b-0 border-line', sheetSurface);

export type FolderTabProps = TabProps & VariantProps<typeof folderTabVariants>;

/**
 * A tab in a stack of case files: the active one is one shape with the sheet
 * below it (same surface, one outline, no line between them); the others are
 * the folders behind. The strip lays them on the sheet's top edge, 1px over.
 */
export const FolderTab = React.forwardRef<HTMLDivElement, FolderTabProps>(function FolderTab(
  { active, muted, indicated, className, ...props },
  ref,
) {
  return (
    <Tab
      ref={ref}
      active={active}
      className={cn(folderTabVariants({ active, muted, indicated }), className)}
      {...props}
    />
  );
});

/** A strip of `indicated` folder tabs' open folder, sliding from tab to tab
 *  (`TabIndicator`; the strip's first child). */
export function FolderTabIndicator({ active }: { active: unknown }) {
  return <TabIndicator active={active} className={folderIndicator} />;
}
