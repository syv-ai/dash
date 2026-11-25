import type * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * A cell `chars` tabular digits wide, so a column of counts lines up down a
 * list whatever each row holds (a blank cell keeps its width). Size it to the
 * list's widest value.
 */
export function CharColumn({
  chars,
  align = 'right',
  className,
  children,
  ...props
}: {
  chars: number;
  align?: 'left' | 'center' | 'right';
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentProps<'span'>, 'style'>) {
  return (
    <span
      {...props}
      className={cn(
        'shrink-0 tabular-nums',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      style={{ width: `${chars}ch` }}
    >
      {children}
    </span>
  );
}
