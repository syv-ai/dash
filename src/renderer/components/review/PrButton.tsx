import { useState } from 'react';
import { ExternalLink, GitPullRequestArrow, MessageSquare } from 'lucide-react';
import { formatTimeAgo } from '@shared/relativeTime';
import type { PrState, PullRequest, RelevantPr, RelevantPrs } from '../../../shared/types';
import { cn } from '../../lib/cn';
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
import { IconButton } from '../ui/IconButton';
import { LineStats } from '../ui/LineStats';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { prStateIcon, prStatusText } from '../ui/prStatusColors';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import { plural, providerName } from './labels';

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
  const searchable = count > SEARCH_FROM;
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
      <PopoverContent
        side="bottom"
        align="end"
        className="w-100"
        onOpenAutoFocus={(e) => {
          if (searchable) return;
          // Without a search box the first focusable is a row's link button;
          // focus the list itself, so its tooltip doesn't open with it.
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[cmdk-root]')?.focus();
        }}
      >
        <Command>
          {searchable && <CommandInput placeholder="Filter by number, title or author" />}
          <CommandList className="max-h-120">
            <CommandEmpty>No matching pull requests</CommandEmpty>
            <PrGroup heading="From this branch" side="from" prs={from} onPick={pick} />
            <PrGroup heading="Into this branch" side="into" prs={into} onPick={pick} />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PrGroup({
  heading,
  side,
  prs,
  onPick,
}: {
  heading: string;
  /** Which end of the PR is this branch: the row names the other one. */
  side: 'from' | 'into';
  prs: readonly RelevantPr[];
  onPick: (pr: PullRequest) => void;
}) {
  if (prs.length === 0) return null;
  return (
    <CommandGroup heading={heading} className="not-first:mt-2">
      {prs.map((p) => (
        <PrItem key={p.number} pr={p} side={side} onPick={() => onPick(p)} />
      ))}
    </CommandGroup>
  );
}

/**
 * One PR: its state icon and title, then who opened it from or into which
 * branch, then its threads, checks, lines and last update, as far as the
 * forge listed them. The row enters review mode; its link button opens the
 * PR on the forge instead.
 */
function PrItem({
  pr,
  side,
  onPick,
}: {
  pr: RelevantPr;
  side: 'from' | 'into';
  onPick: () => void;
}) {
  const state: PrState = pr.draft ? 'draft' : pr.state;
  const Icon = prStateIcon(state);
  const forge = providerName(pr.provider);
  const updated = pr.updatedAt ? Date.parse(pr.updatedAt) / 1000 : NaN;
  return (
    <CommandItem value={`#${pr.number} ${pr.title} ${pr.author}`} onSelect={onPick} entry>
      <span className={cn('flex h-5 items-center', prStatusText(state))} title={state}>
        <Icon size={14} strokeWidth={1.8} aria-label={state} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate leading-5">{pr.title}</span>
        <span className="type-caption truncate tabular-nums">
          {[
            `#${pr.number}`,
            pr.author,
            side === 'into' ? `← ${pr.headRefName}` : `→ ${pr.baseRefName}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="type-caption flex items-center gap-2.5 tabular-nums empty:hidden">
          {pr.threads && pr.threads.total > 0 && (
            <span
              className="flex items-center gap-1 text-icon"
              title={`${pr.threads.open} of ${plural(pr.threads.total, 'thread')} unresolved`}
            >
              <MessageSquare size={14} strokeWidth={1.8} />
              <span className="text-ink-3">
                {pr.threads.open}/{pr.threads.total}
              </span>
            </span>
          )}
          {pr.ci && <ChecksRollupIcon ci={pr.ci} />}
          {pr.additions !== null && pr.deletions !== null && (
            <LineStats add={pr.additions} del={pr.deletions} />
          )}
          {!Number.isNaN(updated) && (
            <span>updated {formatTimeAgo(updated, Date.now() / 1000)}</span>
          )}
        </span>
      </span>
      <IconButton
        size="sm"
        title={`Open #${pr.number} on ${forge}`}
        onClick={(e) => {
          e.stopPropagation();
          void window.electronAPI.openExternal(pr.url);
        }}
        // Keep cmdk from taking the press as the row's own.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ExternalLink size={14} strokeWidth={1.8} />
      </IconButton>
    </CommandItem>
  );
}
