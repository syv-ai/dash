import { cn } from '../../lib/cn';
import { Badge } from './Badge';

/**
 * A count beside a label (sidebar scopes, segmented tabs, section headers).
 * Layout (e.g. `ml-auto`) is the caller's; the badge owns shape and colour.
 * `outline` sets a second count apart from a filled one beside it.
 */
export function CountBadge({
  count,
  tone = 'neutral',
  title,
  className,
}: {
  count: number;
  tone?: 'neutral' | 'outline';
  /** Hover text: what is counted. */
  title?: string;
  className?: string;
}) {
  return (
    <Badge size="sm" tone={tone} title={title} className={cn('min-w-4 justify-center', className)}>
      {count}
    </Badge>
  );
}
