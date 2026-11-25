import { MoreHorizontal, RefreshCw, X } from 'lucide-react';
import type { PrReview } from '../../../shared/types';
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
 * Review mode's head (spec Revision 3): the PR's title (to the forge), its
 * number and state; "who wants to merge n commits into base from head", each
 * linked (the commits to History). Its actions sit on their own row under
 * it, never beside the title: Finish review… when there is one to give,
 * refresh, and the … menu. A failed refresh says why until the next lands.
 */
export function ReviewHeader({
  review,
  remote,
  loading,
  error,
  onRefresh,
  onShowCommits,
  onFinish,
  onExit,
}: {
  review: PrReview;
  /** The project's git remote: where branch links point. */
  remote: string | null;
  loading: boolean;
  /** Why the last refresh failed; null after a good one. */
  error: string | null;
  onRefresh: () => void;
  /** Show the PR's commits in History. */
  onShowCommits: () => void;
  /** Open the Finish-review sheet; absent while there is nothing to finish. */
  onFinish?: () => void;
  /** Leave review mode. */
  onExit: () => void;
}) {
  return (
    <section className="grid gap-1.5 px-2.5 pt-2 pb-1">
      <h2 className="type-heading wrap-break-word">
        <TextLink href={review.url} quiet title={`Open on ${providerName(review.provider)}`}>
          {review.title}
        </TextLink>{' '}
        <span className="text-ink-3 tabular-nums">#{review.number}</span>{' '}
        <Badge size="sm" className="align-middle">
          {STATE_LABELS[review.state]}
        </Badge>
      </h2>
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
      <div className="flex items-center gap-1">
        {onFinish && (
          <Button size="sm" variant="primary" onClick={onFinish}>
            Finish review…
          </Button>
        )}
        <span className="flex-1" />
        <IconButton size="sm" title="Refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} strokeWidth={1.8} className={cn(loading && 'animate-spin')} />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" title="More">
              <MoreHorizontal size={14} strokeWidth={1.8} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onExit}>
              <X size={14} strokeWidth={1.8} />
              Exit review
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <p className="type-caption wrap-break-word" role="status">
          Could not refresh: {error}
        </p>
      )}
    </section>
  );
}
