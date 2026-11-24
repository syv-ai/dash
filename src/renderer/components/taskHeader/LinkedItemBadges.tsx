import type { LinkedItem } from '../../../shared/types';
import { linkedItemUrl } from '../../../shared/urls';
import { badgeVariants } from '../ui/Badge';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/cn';

/**
 * The GitHub issues / ADO work items attached to a task at creation, as small
 * `#id` badges that deep-link to the item (its title on hover). Past `max`, a
 * quiet "+N" stands for the rest.
 */
export function LinkedItemBadges({
  items,
  gitRemote,
  max = 2,
}: {
  items: LinkedItem[];
  gitRemote: string | null;
  max?: number;
}) {
  const overflow = items.length - max;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {items.slice(0, max).map((item) => {
        const url = linkedItemUrl(item, gitRemote);
        const className = cn(badgeVariants(), url && 'hover:bg-select');
        const badge = url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
            #{item.id}
          </a>
        ) : (
          <span className={className}>#{item.id}</span>
        );
        const key = `${item.provider}-${item.id}`;
        return item.title ? (
          <Tooltip key={key} content={item.title}>
            {badge}
          </Tooltip>
        ) : (
          <span key={key}>{badge}</span>
        );
      })}
      {overflow > 0 && <span className="text-xs text-ink-3">+{overflow}</span>}
    </span>
  );
}
