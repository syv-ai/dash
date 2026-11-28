import * as React from 'react';
import { cn } from '../../lib/cn';

/** `warn`: a caution that still lets the person go on (the `warn` role,
 *  never agent state), in its tint and with its icon colour; the text keeps
 *  its caption ink. */
export type NoticeTone = 'warn';

const SURFACE: Record<NoticeTone | 'neutral', string> = {
  neutral: 'border-line bg-well',
  warn: 'border-warn/25 bg-warn/8',
};

const ICON: Record<NoticeTone | 'neutral', string> = {
  neutral: 'text-icon',
  warn: 'text-warn',
};

/**
 * A quiet note inside a surface, saying why it reads as it does (a checkout
 * that differs from the PR): neutral, a leading icon, text that wraps.
 * Unlike `Banner` it names no mode and has no way out. Rounded-lg as a row.
 */
export function Notice({
  icon,
  tone,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'p'>, 'children'> & {
  /** A lucide icon at 14px/1.8. */
  icon?: React.ReactNode;
  tone?: NoticeTone;
  children: React.ReactNode;
}) {
  const key = tone ?? 'neutral';
  return (
    <p
      role="status"
      className={cn(
        'type-caption flex items-start gap-2 rounded-lg border px-2.5 py-1.5 [&_svg]:shrink-0',
        SURFACE[key],
        className,
      )}
      {...props}
    >
      {icon && <span className={cn('flex h-4 shrink-0 items-center', ICON[key])}>{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}
