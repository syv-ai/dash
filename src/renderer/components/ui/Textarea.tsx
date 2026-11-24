import * as React from 'react';
import { cn } from '../../lib/cn';
import { fieldBase } from './styles';

/** Multi-line text field, styled as `Input`. */
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldBase, 'min-h-16 resize-y py-1.5', className)} {...props} />;
}
