import type * as React from 'react';
import { cn } from '../../lib/cn';
import { Checkbox } from './Checkbox';

/**
 * A `Checkbox` with its label beside it, for dialogs and forms; the whole
 * label toggles it, and its text brightens on hover.
 */
export function CheckboxField({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'group flex items-center gap-2.5 text-left',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <Checkbox checked={checked} onChange={() => onChange(!checked)} disabled={disabled} />
      <span
        className={cn(
          'text-base text-ink-2 transition-colors',
          !disabled && 'group-hover:text-ink',
        )}
      >
        {label}
      </span>
    </label>
  );
}
