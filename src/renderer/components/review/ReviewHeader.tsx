import { RefreshCw } from 'lucide-react';
import type { PrReview } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/IconButton';
import { LineStats } from '../ui/LineStats';
import { TextLink } from '../ui/TextLink';
import { prStateIcon, prStatusText } from '../ui/prStatusColors';
import { diffTotals, mergeVerb, plural, providerName } from './labels';

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
 * Review mode's head (spec Revision 3), under the mode's banner and views:
 * the PR's state icon (GitHub's shape and colour) and title (to the forge)
 * with its number, refresh at the row's end; then "who wants to merge n
 * commits (f files, +a −d) into base from head", each linked (the commits to
 * History). A failed refresh says why until the next lands.
 */
export function ReviewHeader({
  review,
  remote,
  loading,
  error,
  onRefresh,
  onShowCommits,
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
}) {
  const StateIcon = prStateIcon(review.state);
  const totals = diffTotals(review.files);
  return (
    <section className="grid gap-1.5 px-2.5 pt-2 pb-1">
      <div className="flex items-start gap-1.5">
        <span
          className={cn('flex h-5 shrink-0 items-center', prStatusText(review.state))}
          title={`${review.state} pull request`}
        >
          <StateIcon size={14} strokeWidth={1.8} aria-label={`${review.state} pull request`} />
        </span>
        <h2 className="type-heading min-w-0 flex-1 wrap-break-word">
          <TextLink href={review.url} quiet title={`Open on ${providerName(review.provider)}`}>
            {review.title}
          </TextLink>{' '}
          <span className="type-label tabular-nums">#{review.number}</span>
        </h2>
        <IconButton
          size="sm"
          title="Refresh"
          onClick={onRefresh}
          disabled={loading}
          className="-my-0.5"
        >
          <RefreshCw size={14} strokeWidth={1.8} className={cn(loading && 'animate-spin')} />
        </IconButton>
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
        <span className="tabular-nums">
          ({plural(totals.files, 'file')}
          {(totals.additions > 0 || totals.deletions > 0) && ', '}
          <LineStats add={totals.additions} del={totals.deletions} />)
        </span>{' '}
        into <Branch remote={remote} name={review.baseRef} /> from{' '}
        <Branch remote={remote} name={review.headRef} />
      </p>
      {error && (
        <p className="type-caption wrap-break-word" role="status">
          Could not refresh: {error}
        </p>
      )}
    </section>
  );
}
