import { MoreHorizontal, RefreshCw, Repeat, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PrReview, TaskReviewTarget } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { IconButton } from '../ui/IconButton';
import { TextLink } from '../ui/TextLink';
import { mergeVerb, plural, providerName, STATE_LABELS } from './labels';
import { SwitchPr } from './SwitchPr';

/** A branch, linked to its page on the forge when the remote names one. */
function Branch({ remote, name }: { remote: string | null; name: string }) {
  const href = remote ? branchUrl(remote, name) : null;
  return href ? (
    <TextLink href={href} quiet title={`Open ${name} on the forge`}>
      <span className="wrap-anywhere">{name}</span>
    </TextLink>
  ) : (
    <span className="wrap-anywhere text-ink">{name}</span>
  );
}

/**
 * The Review view's head, over both tabs: the PR's title (to the forge), its
 * number and state, and Finish review… when there is one to give; "who wants
 * to merge n commits into base from head", each linked (the commits to
 * History); why the PR shows (D94). Refresh, and a menu with Switch PR… and,
 * for a picked PR, Stop reviewing. A failed refresh says why until the next
 * one lands.
 */
export function ReviewHeader({
  review,
  source,
  projectId,
  cwd,
  remote,
  loading,
  error,
  onRefresh,
  onSwitch,
  onStop,
  onShowCommits,
  onFinish,
}: {
  review: PrReview;
  /** Why the task reviews this PR (D3). */
  source: TaskReviewTarget['source'];
  /** Where Switch PR… lists the PRs from. */
  projectId: string;
  cwd: string;
  /** The project's git remote: where branch links point. */
  remote: string | null;
  loading: boolean;
  /** Why the last refresh failed; null after a good one. */
  error: string | null;
  onRefresh: () => void;
  /** Review PR `number` instead; resolves false when it couldn't be loaded. */
  onSwitch: (number: number) => Promise<boolean>;
  /** Stop reviewing the picked PR (back to the branch's own, or none). */
  onStop: () => void;
  /** Show the PR's commits in History. */
  onShowCommits: () => void;
  /** Open the Finish-review sheet; absent while there is nothing to finish. */
  onFinish?: () => void;
}) {
  const [switching, setSwitching] = useState(false);
  // Switch PR… from the menu: the menu's close must not hand focus back to
  // its trigger, which would close the picker as it opens.
  const switchFromMenu = useRef(false);

  return (
    <section className="grid gap-1.5 px-2.5 pt-2 pb-1">
      <div className="flex items-start gap-1">
        <h2 className="type-heading min-w-0 flex-1 pt-0.5 wrap-break-word">
          <TextLink href={review.url} quiet title={`Open on ${providerName(review.provider)}`}>
            {review.title}
          </TextLink>{' '}
          <span className="text-ink-3 tabular-nums">#{review.number}</span>{' '}
          <Badge size="sm" className="align-middle">
            {STATE_LABELS[review.state]}
          </Badge>
        </h2>
        {onFinish && (
          <Button size="sm" variant="primary" onClick={onFinish}>
            Finish review…
          </Button>
        )}
        <IconButton size="sm" title="Refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} strokeWidth={1.8} className={cn(loading && 'animate-spin')} />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" title="More">
              <MoreHorizontal size={14} strokeWidth={1.8} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              if (!switchFromMenu.current) return;
              switchFromMenu.current = false;
              e.preventDefault();
              setSwitching(true);
            }}
          >
            <DropdownMenuItem onSelect={() => (switchFromMenu.current = true)}>
              <Repeat size={14} strokeWidth={1.8} />
              Switch PR…
            </DropdownMenuItem>
            {source === 'stored' && (
              <DropdownMenuItem onSelect={onStop}>
                <X size={14} strokeWidth={1.8} />
                Stop reviewing
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="type-label wrap-break-word">
        {review.authorUrl ? (
          <TextLink href={review.authorUrl} quiet title={`${review.author}'s profile`}>
            {review.author}
          </TextLink>
        ) : (
          <span className="text-ink">{review.author}</span>
        )}{' '}
        {mergeVerb(review.state)}{' '}
        <TextLink quiet title="Show them in History" onClick={onShowCommits}>
          <span className="tabular-nums">{plural(review.commits, 'commit')}</span>
        </TextLink>{' '}
        into <Branch remote={remote} name={review.baseRef} /> from{' '}
        <Branch remote={remote} name={review.headRef} />
      </p>
      <SwitchPr
        open={switching}
        onOpenChange={setSwitching}
        projectId={projectId}
        cwd={cwd}
        selected={review.number}
        onSwitch={onSwitch}
      >
        <p className="type-caption">
          {source === 'own' ? (
            "This branch's pull request"
          ) : (
            <>
              Picked for review ·{' '}
              <TextLink quiet title="Review another PR" onClick={() => setSwitching(true)}>
                Switch PR…
              </TextLink>
            </>
          )}
        </p>
      </SwitchPr>
      {error && (
        <p className="type-caption wrap-break-word" role="status">
          Could not refresh: {error}
        </p>
      )}
    </section>
  );
}
