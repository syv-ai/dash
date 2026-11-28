import * as React from 'react';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { DisclosureChevron } from './DisclosureChevron';

/**
 * A drawer as a card: one item of a list set apart (`Card`'s raised sheet,
 * rounded-xl, hairline). Its `head` always shows, as one aligned column; an
 * action row closes it, the fold on the left (a chevron and what folding
 * hides, `summary`) and the card's `actions` on the right. The body folds
 * open between the head and that row with the drawer motion
 * (`.collapse-grid`, `DisclosureChevron`). Keep its open state with
 * `useSectionOpen`.
 */
export function FoldCard({
  open,
  onOpenChange,
  head,
  summary,
  actions,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The always-shown part. */
  head: React.ReactNode;
  /** What unfolding shows, as the fold's label ("Reviewers, checks and dates"). */
  summary: string;
  /** The card's buttons, at the right of its action row. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Layout only. */
  className?: string;
}) {
  const id = React.useId();
  return (
    <article
      className={cn(
        // `min-h-min`: clipped to its corners (overflow-hidden), a grid or
        // flex item would otherwise be free to shrink below its content.
        'min-h-min min-w-0 shrink-0 overflow-hidden rounded-xl border border-line bg-raised text-ink',
        className,
      )}
    >
      <div className="grid gap-3 px-4 pt-3.5 pb-3">{head}</div>
      <div id={id} className="collapse-grid" data-open={open}>
        <div>
          <div className="border-t border-line">{children}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => onOpenChange(!open)}
          className="min-w-0 gap-1.5"
        >
          <DisclosureChevron open={open} />
          <span className="truncate">{summary}</span>
        </Button>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </article>
  );
}
