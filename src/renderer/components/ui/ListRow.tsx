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
      size: { sm: 'h-8 text-sm', md: 'h-9 text-base' },
      // A second line: the row grows; leading and trailing centre on both
      // lines (T21).
      twoLine: { true: 'h-auto py-2', false: '' },
      dimmed: {
        true: 'text-ink-3 hover:text-ink data-[selected=true]:text-ink',
        false: '',
      },
      // A changed file's name (G1); a dimmed row stays dimmed.
      changed: { true: '', false: '' },
      // The row being dragged to a new place: faded where it will land.
      dragging: { true: 'opacity-40', false: '' },
      // A physical press: the row shrinks a touch while held and springs
      // back on release (100ms ease-out; `scale` takes no layout, so nothing
      // beside it moves). Not while a control inside it is the one pressed,
      // and not at all under reduced motion. Tailwind v4's scale-* sets
      // `scale`, not `transform`, so that is the property listed.
      pressable: {
        true: 'transition-[color,background-color,scale] duration-[150ms,150ms,100ms] ease-out motion-safe:active:not-has-[button:active]:scale-98',
        false: '',
      },
    },
    compoundVariants: [{ changed: true, dimmed: false, className: 'text-changed' }],
    defaultVariants: {
      size: 'md',
      twoLine: false,
      dimmed: false,
      changed: false,
      dragging: false,
      pressable: false,
    },
  },
);

export type ListRowProps = Omit<React.ComponentProps<'button'>, 'children'> &
  Pick<VariantProps<typeof listRowVariants>, 'size'> & {
    /** Current row: the select tint (and aria-current). */
    selected?: boolean;
    /** A second line under the label (a reason, a path), in `type-caption`
     *  unless the node passed in colours itself. */
    description?: React.ReactNode;
    /** Right after the label on its line, never truncated (the label gives
     *  way): non-interactive marks such as the main-checkout M or a
     *  favourite's star. */
    badges?: React.ReactNode;
    /** Quiet row (ink-3) that reads normally on hover or when selected. */
    dimmed?: boolean;
    /** A changed file or folder: its label in the `changed` gold (G1). */
    changed?: boolean;
    /** Being dragged to reorder: faded. */
    dragging?: boolean;
    /** Shrinks a touch while pressed, a physical click (the task cards). */
    pressable?: boolean;
    /** The focused task or project: its label (not the second line) in semibold. */
    strong?: boolean;
    /** Before the label: a StatusDot, a file icon. An icon that doesn't
     *  colour itself rests in the icon token. */
    leading?: React.ReactNode;
    /** At the row's end: a count, a time, hover actions. */
    trailing?: React.ReactNode;
    children: React.ReactNode;
    /** `div` when `trailing` holds buttons (buttons can't nest); the caller
     *  then owns the row's role, focus and keyboard handling. */
    as?: 'button' | 'div';
    /** Tree depth: each level indents the row by `indentStep`. */
    indent?: number;
    /** Pixels per tree level; TREE_INDENT_PX unless a tree spaces its levels wider. */
    indentStep?: number;
  };

/** A `strong` row's label weight: the type roles' heading weight. */
const STRONG = 'font-semibold';

/** Horizontal step per tree level in an indented `ListRow`. */
export const TREE_INDENT_PX = 12;

/**
 * A sidebar or tree row: 32–36px, rounded-lg, hover tint, select tint when
 * `selected`. Leading slot, truncating label (with badges after it and an
 * optional second line), trailing slot (ink-3).
 */
export function ListRow({
  selected = false,
  description,
  dimmed = false,
  changed = false,
  dragging = false,
  pressable = false,
  strong = false,
  badges,
  leading,
  trailing,
  size,
  as = 'button',
  indent,
  indentStep = TREE_INDENT_PX,
  className,
  style,
  children,
  type = 'button',
  ...props
}: ListRowProps) {
  const Comp = as;
  const text = <span className={cn('min-w-0 truncate', strong && STRONG)}>{children}</span>;
  const label = badges ? (
    <span className="flex min-w-0 items-center gap-1.5">
      {text}
      <span className="flex shrink-0 items-center gap-1">{badges}</span>
    </span>
  ) : (
    text
  );
  return (
    <Comp
      type={as === 'button' ? type : undefined}
      data-selected={selected}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        listRowVariants({ size, dimmed, changed, dragging, pressable, twoLine: !!description }),
        className,
      )}
      // px-2.5 is 10px; a tree row adds its depth to the left of it.
      style={indent ? { ...style, paddingLeft: 10 + indent * indentStep } : style}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {leading && <span className="flex h-5 shrink-0 items-center text-icon">{leading}</span>}
      {/* Label and trailing keep the badges' gap (gap-1), not the row's: a
          truncated name runs as close to the end as its marks sit to each
          other (T26). */}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        {description ? (
          <span className="flex min-w-0 flex-1 flex-col">
            {label}
            <span className="truncate type-caption">{description}</span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-1">{label}</span>
        )}
        {trailing && (
          <span className="flex shrink-0 items-center gap-1.5 text-ink-3">{trailing}</span>
        )}
      </span>
    </Comp>
  );
}
