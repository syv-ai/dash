import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

const listRowVariants = cva(
  cn(
    'group/row flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-ink transition-colors duration-150 hover:bg-hover data-[selected=true]:bg-select [&_svg]:shrink-0',
    focusRing,
  ),
  {
    variants: {
      size: { sm: 'h-7 text-sm', md: 'h-8 text-base' },
    },
    defaultVariants: { size: 'md' },
  },
);

export type ListRowProps = Omit<React.ComponentProps<'button'>, 'children'> &
  VariantProps<typeof listRowVariants> & {
    /** Current row: the select tint (and aria-current). */
    selected?: boolean;
    /** Before the label: a StatusDot, a file icon. */
    leading?: React.ReactNode;
    /** At the row's end: a count, a time, hover actions. */
    trailing?: React.ReactNode;
    children: React.ReactNode;
    /** `div` when `trailing` holds buttons (buttons can't nest); the caller
     *  then owns the row's role, focus and keyboard handling. */
    as?: 'button' | 'div';
  };

/**
 * A sidebar or tree row: 28–32px, rounded-lg, hover tint, select tint when
 * `selected`. Leading slot, truncating label, trailing slot (ink-3).
 */
export function ListRow({
  selected = false,
  leading,
  trailing,
  size,
  as = 'button',
  className,
  children,
  type = 'button',
  ...props
}: ListRowProps) {
  const Comp = as;
  return (
    <Comp
      type={as === 'button' ? type : undefined}
      data-selected={selected}
      aria-current={selected ? 'true' : undefined}
      className={cn(listRowVariants({ size }), className)}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span className="flex shrink-0 items-center gap-1 text-ink-3">{trailing}</span>}
    </Comp>
  );
}
