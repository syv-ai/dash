import type { ReactNode } from 'react';
import { branchUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { TextLink } from '../ui/TextLink';
import { prStateIcon, prStatusText } from '../ui/prStatusColors';
import { mergeVerb, plural, providerName } from './labels';
import type { PrHead } from './prList';

/** A branch, linked to its page on the forge when the remote names one. */
export function Branch({ remote, name }: { remote: string | null; name: string }) {
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
 * A PR's head: review mode's (spec Revision 3), under the mode's banner and
 * views, and each PR's in the PRs view. The PR's state icon (GitHub's shape
 * and colour) and title (to the forge, in the heading's ink: D274) with its
 * number, and an `action` at the row's end; then "who wants to merge n
 * commits into base from head" in secondary ink, its links in the link
 * colour (the commits to History, where `onShowCommits` is given; a listed
 * PR not yet fetched leaves the count out). The diff totals are About's. A
 * failed reload says why until the next lands (reloads are automatic in
 * review mode: `useReviewData`).
 */
export function ReviewHeader({
  review,
  remote,
  error,
  onShowCommits,
  action,
}: {
  review: PrHead;
  /** The project's git remote: where branch links point. */
  remote: string | null;
  /** Why the last reload failed; null after a good one. */
  error: string | null;
  /** Show the PR's commits in History; without it the count is plain text. */
  onShowCommits?: () => void;
  /** A control at the title row's end (the PRs view's Review). */
  action?: ReactNode;
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
          <TextLink
            href={review.url}
            inkAt="review-title"
            title={`Open on ${providerName(review.provider)}`}
          >
            {review.title}
          </TextLink>{' '}
          <span className="type-label tabular-nums">#{review.number}</span>
        </h2>
        {action && <div className="shrink-0">{action}</div>}
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
        {review.commits !== null && (
          <>
            <Commits count={review.commits} onShow={onShowCommits} />{' '}
          </>
        )}
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

/** "4 commits", a link to History where it can show them. */
function Commits({ count, onShow }: { count: number; onShow?: () => void }) {
  const text = <span className="tabular-nums">{plural(count, 'commit')}</span>;
  return onShow ? (
    <TextLink title="Show them in History" onClick={onShow}>
      {text}
    </TextLink>
  ) : (
    text
  );
}
