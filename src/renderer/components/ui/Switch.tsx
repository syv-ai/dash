import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

const switchVariants = cva(
  cn(
    'group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 bg-select aria-checked:bg-ink-3 disabled:cursor-not-allowed disabled:opacity-40',
    focusRing,
  ),
  {
    variants: {
      size: { sm: 'h-4 w-7', md: 'h-4.5 w-8' },
    },
    defaultVariants: { size: 'md' },
  },
);

const thumbVariants = cva(
  'pointer-events-none block rounded-full bg-ink-2 transition-[translate,background-color] duration-200 ease-out group-aria-checked/switch:bg-ground',
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
  VariantProps<typeof switchVariants> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  };

/**
 * The on/off switch (shadcn Switch API: `checked` / `onCheckedChange`). On is
 * an ink-3 track under a ground thumb, off a select tint under an ink-2 one:
 * clearly on without the button tone's glare in dark (G4). For a labelled
 * row use `SwitchField`.
 */
export function Switch({
  checked,
  onCheckedChange,
  size,
  disabled,
  className,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(switchVariants({ size }), className)}
      onClick={(e) => {
        onClick?.(e);
        // Rows often answer clicks themselves; the switch's click is its own.
        e.stopPropagation();
        if (!disabled) onCheckedChange(!checked);
      }}
      {...props}
    >
      <span aria-hidden className={thumbVariants({ size })} />
    </button>
  );
}
