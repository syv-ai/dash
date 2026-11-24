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
      // A second line: the row grows and the leading slot stays on the first.
      twoLine: { true: 'h-auto items-start py-1.5', false: '' },
      dimmed: {
        true: 'text-ink-3 hover:text-ink data-[selected=true]:text-ink',
        false: '',
      },
    },
    defaultVariants: { size: 'md', twoLine: false, dimmed: false },
  },
);

export type ListRowProps = Omit<React.ComponentProps<'button'>, 'children'> &
  Pick<VariantProps<typeof listRowVariants>, 'size'> & {
    /** Current row: the select tint (and aria-current). */
    selected?: boolean;
    /** A second, smaller line under the label (a reason, a path). It is ink-3
     *  unless the node passed in colours itself. */
    description?: React.ReactNode;
    /** Quiet row (ink-3) that reads normally on hover or when selected. */
    dimmed?: boolean;
    /** Before the label: a StatusDot, a file icon. */
    leading?: React.ReactNode;
    /** At the row's end: a count, a time, hover actions. */
    trailing?: React.ReactNode;
    children: React.ReactNode;
    /** `div` when `trailing` holds buttons (buttons can't nest); the caller
     *  then owns the row's role, focus and keyboard handling. */
    as?: 'button' | 'div';
    /** Tree depth: each level indents the row by TREE_INDENT_PX. */
    indent?: number;
  };

/** Horizontal step per tree level in an indented `ListRow`. */
export const TREE_INDENT_PX = 12;

/**
 * A sidebar or tree row: 28–32px, rounded-lg, hover tint, select tint when
 * `selected`. Leading slot, truncating label (with an optional second line),
 * trailing slot (ink-3).
 */
export function ListRow({
  selected = false,
  description,
  dimmed = false,
  leading,
  trailing,
  size,
  as = 'button',
  indent,
  className,
  style,
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
      className={cn(listRowVariants({ size, dimmed, twoLine: !!description }), className)}
      // px-2.5 is 10px; a tree row adds its depth to the left of it.
      style={indent ? { ...style, paddingLeft: 10 + indent * TREE_INDENT_PX } : style}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {leading && <span className="flex h-5 shrink-0 items-center">{leading}</span>}
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{children}</span>
          <span className="truncate text-sm text-ink-3">{description}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{children}</span>
      )}
      {trailing && <span className="flex shrink-0 items-center gap-1 text-ink-3">{trailing}</span>}
    </Comp>
  );
}
