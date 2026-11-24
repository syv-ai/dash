import * as React from 'react';
import { cn } from '../../lib/cn';
import { fieldBase } from './styles';

/** Single-line text field: hover-tint fill, no border; focus = line ring on the well. */
export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(fieldBase, 'h-7.5', className)} {...props} />;
}
