import type { PrReview } from '../../../shared/types';
import { branchUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { TextLink } from '../ui/TextLink';
import { prStateIcon, prStatusText } from '../ui/prStatusColors';
import { mergeVerb, plural, providerName } from './labels';

/** A branch, linked to its page on the forge when the remote names one. */
function Branch({ remote, name }: { remote: string | null; name: string }) {
  const href = remote ? branchUrl(remote, name) : null;
  return href ? (
    <TextLink href={href} title={`Open ${name} on the forge`}>
      <span className="wrap-anywhere">{name}</span>
    </TextLink>
  ) : (
    <span className="wrap-anywhere">{name}</span>
  );
}

/**
 * Review mode's head (spec Revision 3), under the mode's banner and views:
 * the PR's state icon (GitHub's shape and colour) and title (to the forge)
 * with its number; then "who wants to merge n
 * commits into base from head" in secondary ink, its links in the link
 * colour (the commits to History). The diff totals are About's (Overview). A failed
 * reload says why until the next lands (reloads are automatic: `useReviewData`).
 */
export function ReviewHeader({
  review,
  remote,
  error,
  onShowCommits,
}: {
  review: PrReview;
  /** The project's git remote: where branch links point. */
  remote: string | null;
  /** Why the last reload failed; null after a good one. */
  error: string | null;
  /** Show the PR's commits in History. */
  onShowCommits: () => void;
}) {
  const StateIcon = prStateIcon(review.state);
  return (
    <section className="grid gap-3 px-2.5 pt-6 pb-3">
      <div className="flex items-start gap-1.5">
        <span
          className={cn('flex h-5 shrink-0 items-center', prStatusText(review.state))}
          title={`${review.state} pull request`}
        >
          <StateIcon size={14} strokeWidth={1.8} aria-label={`${review.state} pull request`} />
        </span>
        <h2 className="type-heading min-w-0 flex-1 wrap-break-word">
          <TextLink href={review.url} title={`Open on ${providerName(review.provider)}`}>
            {review.title}
          </TextLink>{' '}
          <span className="type-label tabular-nums">#{review.number}</span>
        </h2>
      </div>
      {/* Running prose, not a name: secondary ink, no type role (D162); its
          links in the link colour (D191). */}
      <p className="text-sm text-ink-2 wrap-break-word">
        {review.authorUrl ? (
          <TextLink href={review.authorUrl} title={`${review.author}'s profile`}>
            {review.author}
          </TextLink>
        ) : (
          review.author
        )}{' '}
        {mergeVerb(review.state)}{' '}
        <TextLink title="Show them in History" onClick={onShowCommits}>
          <span className="tabular-nums">{plural(review.commits, 'commit')}</span>
        </TextLink>{' '}
        into <Branch remote={remote} name={review.baseRef} /> from{' '}
        <Branch remote={remote} name={review.headRef} />
      </p>
      {error && (
        <p className="type-caption wrap-break-word" role="status">
          Could not reload: {error}
        </p>
      )}
    </section>
  );
}
