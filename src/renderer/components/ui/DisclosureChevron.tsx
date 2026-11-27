import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * The chevron of everything that folds (a drawer's header, a thread card's,
 * a form's optional fields): right when shut, turned down when open, in step
 * with `.collapse-grid` (200ms `ease-drawer`; none under reduced motion).
 */
export function DisclosureChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      size={14}
      strokeWidth={1.8}
      aria-hidden
      className={cn(
        'shrink-0 text-icon transition-transform duration-200 ease-drawer motion-reduce:transition-none',
        open && 'rotate-90',
        className,
      )}
    />
  );
}
