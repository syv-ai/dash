import type { ReactNode } from 'react';
import { branchUrl } from '../../../shared/urls';
import { cn } from '../../lib/cn';
import { TextLink } from '../ui/TextLink';
import { prStateIcon, prStatusText } from '../ui/prStatusColors';
import { mergeVerb, plural, providerName } from './labels';
import type { PrHead } from './prList';

/** A branch, linked to its page on the forge when the remote names one. */
/** A branch, linked to its page: `href` where the caller knows it (a fork's
 *  branch), else origin's by `remote`; plain text with neither. */
export function Branch({
  remote,
  name,
  href: given = null,
}: {
  remote: string | null;
  name: string;
  href?: string | null;
}) {
  const href = given ?? (remote ? branchUrl(remote, name) : null);
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
 * views. The PR's title row (`PrTitle`) with an `action` at its end, then
 * who wants to merge what into what (`PrMergeLine`). The diff totals are
 * About's. A failed reload says why until the next lands (reloads are
 * automatic in review mode: `useReviewData`). A PR card (`PrCard`) builds its
 * own head from the same two pieces.
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
  /** A control at the title row's end. */
  action?: ReactNode;
}) {
  return (
    <section className="grid gap-3 px-2.5 pt-6 pb-3">
      <PrTitle review={review} action={action} />
      <PrMergeLine review={review} remote={remote} onShowCommits={onShowCommits} />
      {error && (
        <p className="type-caption wrap-break-word" role="status">
          Could not reload: {error}
        </p>
      )}
    </section>
  );
}

/**
 * A PR's title row: its state icon (GitHub's shape and colour, D133) and
 * title (to the forge, in the heading's ink: D274) with its number; `lead`
 * before them (a card's fold), `action` at the row's end.
 */
export function PrTitle({
  review,
  lead,
  action,
}: {
  review: Pick<PrHead, 'state' | 'url' | 'provider' | 'title' | 'number'>;
  lead?: ReactNode;
  action?: ReactNode;
}) {
  const StateIcon = prStateIcon(review.state);
  return (
    <div className="flex items-start gap-1.5">
      {lead}
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
  );
}

/**
 * "who wants to merge n commits into base from head", in secondary ink, its
 * links in the link colour: the author to their profile, the commits to
 * History where `onShowCommits` is given (a PR read without git leaves the
 * count out), the branches to the forge (a fork's head is plain text, as
 * origin has no such branch).
 */
export function PrMergeLine({
  review,
  remote,
  onShowCommits,
}: {
  review: PrHead;
  remote: string | null;
  onShowCommits?: () => void;
}) {
  return (
    // Running prose, not a name: secondary ink, no type role (D162); its
    // links in the link colour (D191).
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
      {/* A fork's branch isn't origin's: linked to the fork, where known. */}
      {review.headFromFork ? (
        <Branch remote={null} href={review.forkHeadUrl} name={review.headRef} />
      ) : (
        <Branch remote={remote} name={review.headRef} />
      )}
    </p>
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
