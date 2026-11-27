import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

const switchVariants = cva(
  cn(
    'group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-calm bg-select aria-checked:bg-ink-3 disabled:cursor-not-allowed',
    focusRing,
  ),
  {
    variants: {
      size: { sm: 'h-4 w-7', md: 'h-4.5 w-8' },
      // Locked keeps its colours: a faded track reads as off (in light, a
      // pale track under the thumb), and a locked switch still states its value.
      locked: { false: 'disabled:opacity-40', true: '' },
    },
    defaultVariants: { size: 'md', locked: false },
  },
);

const thumbVariants = cva(
  'pointer-events-none block rounded-full bg-ink-2 transition-[translate,background-color] duration-calm ease-settle group-aria-checked/switch:bg-ground',
  {
    variants: {
      size: {
        sm: 'size-3 group-aria-checked/switch:translate-x-3',
        md: 'size-3.5 group-aria-checked/switch:translate-x-3.5',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export type SwitchProps = Omit<React.ComponentProps<'button'>, 'onChange' | 'value'> &
  Omit<VariantProps<typeof switchVariants>, 'locked'> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    /** Held where it is for a reason given beside it: it can't be toggled,
     *  but unlike `disabled` it keeps its colours, so on still reads as on. */
    locked?: boolean;
  };

/**
 * The on/off switch (shadcn Switch API: `checked` / `onCheckedChange`). On is
 * an ink-3 track under a ground thumb, off a select tint under an ink-2 one:
 * clearly on without the button tone's glare in dark (G4). `disabled` fades
 * it (not applicable now); `locked` holds it at full colour (see `SwitchField`
 * for the lock cue). For a labelled row use `SwitchField`.
 */
export function Switch({
  checked,
  onCheckedChange,
  size,
  disabled,
  locked = false,
  className,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || locked}
      className={cn(switchVariants({ size, locked: locked && !disabled }), className)}
      onClick={(e) => {
        onClick?.(e);
        // Rows often answer clicks themselves; the switch's click is its own.
        e.stopPropagation();
        if (!disabled && !locked) onCheckedChange(!checked);
      }}
      {...props}
    >
      <span aria-hidden className={thumbVariants({ size })} />
    </button>
  );
}
