import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

/**
 * The header row that folds a card or section open and shut: a chevron
 * (turned down when open) before any content, a hover tint, `aria-expanded`.
 * It grows to fill its row; actions beside it sit outside it. Content is
 * top-aligned, the chevron centred on a 28px first line (`h-7`): give the
 * content's first line that height to line up with it.
 */
export function DisclosureButton({
  open,
  onOpenChange,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick'> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
      className={cn(
        'flex min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-hover',
        focusRing,
        className,
      )}
      {...props}
    >
      <span className="flex h-7 shrink-0 items-center">
        <ChevronRight
          size={14}
          strokeWidth={1.8}
          className={cn('text-icon transition-transform duration-150', open && 'rotate-90')}
        />
      </span>
      {children}
    </button>
  );
}
