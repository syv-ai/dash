import * as React from 'react';
import { cn } from '../../lib/cn';
import { DisclosureChevron } from './DisclosureChevron';
import { IconButton } from './IconButton';

/**
 * A drawer as a card: one item of a list set apart (`Card`'s raised sheet,
 * rounded-xl, hairline) whose `head` always shows and whose body folds away
 * under it with the drawer motion (`.collapse-grid`, `DisclosureChevron`).
 * The fold control leads the head (`fold`, given to the head to place on its
 * first row, so it sits beside the title); a click on the head's bare
 * surface folds too, its links and buttons keeping their own clicks. Keep its
 * open state with `useSectionOpen`.
 */
export function FoldCard({
  open,
  onOpenChange,
  head,
  label,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The always-shown part; `fold` is the control to place in it. */
  head: (fold: React.ReactNode) => React.ReactNode;
  /** What the fold control's tooltip names ("this pull request"). */
  label: string;
  children: React.ReactNode;
  /** Layout only. */
  className?: string;
}) {
  const id = React.useId();
  const fold = (
    <IconButton
      size="sm"
      title={open ? `Fold ${label}` : `Unfold ${label}`}
      aria-expanded={open}
      aria-controls={id}
      onClick={() => onOpenChange(!open)}
      // The chevron centres on the title's first line.
      className="-my-0.75 -ml-1"
    >
      <DisclosureChevron open={open} />
    </IconButton>
  );
  return (
    <article
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border border-line bg-raised text-ink',
        className,
      )}
    >
      <div
        className="grid gap-2 p-3"
        // The head's bare surface folds it too (a pointer convenience; the
        // fold control is the keyboard's way).
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a,button,[role=button],input'))
            onOpenChange(!open);
        }}
      >
        {head(fold)}
      </div>
      <div id={id} className="collapse-grid" data-open={open}>
        <div>
          <div className="border-t border-line">{children}</div>
        </div>
      </div>
    </article>
  );
}
