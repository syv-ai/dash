import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';
import { Tab, type TabProps } from './Tab';

/**
 * The sheet's surface: the terminal palette's background when the host sets
 * `--sheet-bg` (as every sheet does), else the well. A folder tab and the
 * sheet it opens into must share it exactly.
 */
export const sheetSurface = 'bg-(--sheet-bg,var(--color-well))';

const folderTabVariants = cva(
  cn(
    'group/tab relative flex min-w-11 max-w-48 shrink-0 cursor-pointer items-center rounded-t-lg pr-4 pl-3 select-none',
    'transition-[translate,background-color,color] duration-150',
    focusRing,
    // Inset, so the strip's scroll clip can't cut it.
    'focus-visible:-outline-offset-2',
  ),
  {
    variants: {
      // The open folder: on the sheet's surface, outlined on three sides, its
      // open bottom laid over the sheet's top edge (the strip overlaps the
      // sheet by 1px). The rest sit behind on the chrome, and lift on hover.
      active: {
        true: cn('z-10 h-8 border border-b-0 border-line text-ink', sheetSurface),
        false: 'mb-px h-7 text-ink-2 hover:-translate-y-px hover:bg-hover hover:text-ink',
      },
      // The open folder of a stack that isn't focused: still open, quieter.
      muted: { true: '', false: '' },
    },
    compoundVariants: [{ active: true, muted: true, className: 'text-ink-2' }],
    defaultVariants: { active: false, muted: false },
  },
);

export type FolderTabProps = TabProps & VariantProps<typeof folderTabVariants>;

/**
 * A tab in a stack of case files: the active one is one shape with the sheet
 * below it (same surface, one outline, no line between them); the others are
 * the folders behind. The strip lays them on the sheet's top edge, 1px over.
 */
export const FolderTab = React.forwardRef<HTMLDivElement, FolderTabProps>(function FolderTab(
  { active, muted, className, ...props },
  ref,
) {
  return (
    <Tab
      ref={ref}
      active={active}
      className={cn(folderTabVariants({ active, muted }), className)}
      {...props}
    />
  );
});
