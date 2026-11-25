import { useState } from 'react';
import { GitPullRequestArrow } from 'lucide-react';
import type { PullRequest, RelevantPrs } from '../../../shared/types';
import { Button } from '../ui/Button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/Command';
import { CountBadge } from '../ui/CountBadge';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { plural } from './labels';

/** Past this many PRs the list offers a search. */
const SEARCH_FROM = 8;

/**
 * The sidebar header's way into review mode (spec Revision 3). Normal mode:
 * a button counting the open PRs from and into the task's branch (hidden at
 * none), badged with the unresolved threads on the branch's own PR; it opens
 * the list, grouped "From this branch" / "Into this branch". Normal mode
 * only: review mode says itself, and exits, in the PR's header.
 */
export function PrButton({
  relevant,
  own,
  onOpen,
  onPick,
}: {
  relevant: RelevantPrs | null;
  /** The branch's own PR and its unresolved threads (0: no badge). */
  own: { number: number; threads: number } | null;
  /** The list is opening: list the PRs again. */
  onOpen: () => void;
  onPick: (pr: PullRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const from = relevant?.from ?? [];
  const into = relevant?.into ?? [];
  const count = from.length + into.length;
  if (count === 0) return null;
  const label = `${plural(count, 'pull request')} from or into this branch`;
  const pick = (pr: PullRequest) => {
    setOpen(false);
    onPick(pr);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen();
        setOpen(next);
      }}
    >
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={label}>
            <GitPullRequestArrow size={14} strokeWidth={1.8} />
            <span className="tabular-nums">{count}</span>
            {own && own.threads > 0 && (
              <CountBadge
                count={own.threads}
                tone="outline"
                title={`${plural(own.threads, 'unresolved thread')} on #${own.number}`}
              />
            )}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="bottom" align="end" className="w-85">
        <Command>
          {count > SEARCH_FROM && <CommandInput placeholder="Filter by number, title or author" />}
          <CommandList className="max-h-95">
            <CommandEmpty>No matching pull requests</CommandEmpty>
            <PrGroup heading="From this branch" prs={from} onPick={pick} />
            <PrGroup heading="Into this branch" prs={into} onPick={pick} />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PrGroup({
  heading,
  prs,
  onPick,
}: {
  heading: string;
  prs: readonly PullRequest[];
  onPick: (pr: PullRequest) => void;
}) {
  if (prs.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {prs.map((p) => (
        <CommandItem
          key={p.number}
          value={`#${p.number} ${p.title} ${p.author}`}
          onSelect={() => onPick(p)}
          description={`${p.author ? `@${p.author} · ` : ''}${p.headRefName} → ${p.baseRefName}`}
        >
          <span className="type-label shrink-0 tabular-nums">#{p.number}</span>
          <span className="truncate">{p.title}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
