import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { PrDetails, RelevantPr } from '../../../shared/types';
import type { ReviewVerdict } from '../../../shared/prVerdict';
import { usePrDetails } from '../../hooks/useProjectPrs';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { TextLink } from '../ui/TextLink';
import { prStateIcon, prStatusText } from '../ui/prStatusColors';
import { providerName } from './labels';
import { prHead, yourStanding } from './prList';
import { PrMergeLine } from './ReviewHeader';

/** One PR in the task's PRs view: its card, its details read from the forge
 *  alone (no git), as the project page's are. */
export function ListedPr({
  pr,
  projectId,
  remote,
  onReview,
}: {
  pr: RelevantPr;
  projectId: string;
  /** The project's remote: where branch and people links point. */
  remote: string | null;
  /** Enter review mode on it. */
  onReview: () => void;
}) {
  const { details, error } = usePrDetails(projectId, pr);
  return <PrCard pr={pr} details={details} error={error} remote={remote} onReview={onReview} />;
}

/** The review's standing, as its label says it. */
const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  pending: 'Review required',
};

/** A click that a link or button in the card already answers. */
const fromOwnControl = (target: EventTarget, card: EventTarget) => {
  const hit = (target as HTMLElement).closest('a,button,[role=button]');
  return !!hit && hit !== card;
};

/**
 * A PR as a card, wherever PRs are listed (the task's PRs view, the project
 * page): its state-coloured icon and title; its number (to the forge) and
 * where its review stands; who wants to merge how many commits into what
 * from what; and one line about the person ("You approved it 2 days ago"),
 * held by a skeleton of its size until the PR's details come, so nothing
 * moves when they do. The card is the way into review mode; its links keep
 * their own clicks. `actions` sits at the title's end (the project page's
 * task, or Start task).
 */
export function PrCard({
  pr,
  details,
  error,
  remote,
  actions,
  onReview,
}: {
  pr: RelevantPr;
  /** Its details from the forge; null until they've come. */
  details: PrDetails | null;
  /** Why the details couldn't be read; null otherwise. */
  error: string | null;
  remote: string | null;
  actions?: ReactNode;
  onReview: () => void;
}) {
  const head = prHead(pr, details, remote);
  const StateIcon = prStateIcon(head.state);
  const onClick = (e: MouseEvent) => {
    if (!fromOwnControl(e.target, e.currentTarget)) onReview();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onReview();
  };
  return (
    <Card
      padding="none"
      role="button"
      tabIndex={0}
      aria-label={`Review #${pr.number} ${pr.title}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="grid shrink-0 cursor-pointer gap-2.5 px-4 py-3.5 transition-colors duration-quick ease-settle hover:bg-hover"
    >
      <div className="grid gap-1">
        <div className="flex items-start gap-2">
          <span
            className={cn('flex h-5 shrink-0 items-center', prStatusText(head.state))}
            title={`${head.state} pull request`}
          >
            <StateIcon size={14} strokeWidth={1.8} aria-label={`${head.state} pull request`} />
          </span>
          <h3 className="type-heading min-w-0 flex-1 wrap-break-word">{head.title}</h3>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        <div className="flex items-center gap-2 pl-5.5">
          <span className="type-label tabular-nums">
            <TextLink href={head.url} title={`Open on ${providerName(head.provider)}`}>
              #{head.number}
            </TextLink>
          </span>
          {pr.verdict && <Badge size="sm">{VERDICT_LABELS[pr.verdict]}</Badge>}
        </div>
      </div>
      <PrMergeLine review={head} remote={remote} yours={pr.viewer?.isAuthor ?? false} />
      <p className="type-body text-ink-2">
        {details ? (
          yourStanding(details, Date.now())
        ) : error ? (
          <span className="type-caption">Couldn't read your part in it: {error}</span>
        ) : (
          <Skeleton className="inline-block h-4 w-44 align-middle" />
        )}
      </p>
    </Card>
  );
}
