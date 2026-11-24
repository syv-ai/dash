import { cn } from '../../lib/cn';
import { Badge } from './Badge';

/**
 * A count beside a label (sidebar scopes, segmented tabs, section headers).
 * Layout (e.g. `ml-auto`) is the caller's; the badge owns shape and colour.
 */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <Badge size="sm" className={cn('min-w-4 justify-center', className)}>
      {count}
    </Badge>
  );
}
