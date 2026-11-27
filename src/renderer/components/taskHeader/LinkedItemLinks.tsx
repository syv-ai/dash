import type { LinkedItem } from '../../../shared/types';
import { linkedItemUrl } from '../../../shared/urls';
import { TextLink } from '../ui/TextLink';
import { Tooltip } from '../ui/Tooltip';

/**
 * The GitHub issues / ADO work items attached to a task at creation, as
 * `#id` links to the item (its title on hover; plain `#id` where the remote
 * gives no URL). Past `max`, a quiet "+N" stands for the rest.
 */
export function LinkedItemLinks({
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
    <span className="inline-flex min-w-0 items-center gap-1.5 tabular-nums">
      {items.slice(0, max).map((item) => {
        const url = linkedItemUrl(item, gitRemote);
        const id = `#${item.id}`;
        const link = url ? <TextLink href={url}>{id}</TextLink> : <span>{id}</span>;
        const key = `${item.provider}-${item.id}`;
        return item.title ? (
          <Tooltip key={key} content={item.title}>
            <span>{link}</span>
          </Tooltip>
        ) : (
          <span key={key}>{link}</span>
        );
      })}
      {overflow > 0 && <span className="text-ink-3">+{overflow}</span>}
    </span>
  );
}
