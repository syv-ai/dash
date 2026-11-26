import * as React from 'react';
import { cn } from '../../lib/cn';
import { fieldBase } from './styles';

/** Single-line text field: hover-tint fill, no border; focus = line ring on
 *  the well. `mono` for code (an env var, a path to a binary). */
export function Input({
  className,
  type = 'text',
  mono = false,
  ...props
}: React.ComponentProps<'input'> & { mono?: boolean }) {
  return (
    <input
      type={type}
      className={cn(
        fieldBase,
        'h-7.5',
        mono && 'font-mono',
        // A number field is typed into; the native spinners don't fit the look.
        type === 'number' &&
          'tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        className,
      )}
      {...props}
    />
  );
}
