import { useState, type ReactElement } from 'react';
import { formatRelativeTime } from '../../../shared/relativeTime';
import type { CommitSummary } from '../diffEditor/types';
import { HoverCard, type HoverCardTrigger } from '../ui/HoverCard';
import { LineStats } from '../ui/LineStats';
import { TextLink } from '../ui/TextLink';
import { useCommitLinks } from './useCommitLinks';

/**
 * A commit's hover card: its subject, its message, then the short hash
 * (linked to the commit's forge page once pushed), the author (linked to
 * their profile where the forge knows them), its age and line counts.
 */
export function CommitHoverCard({
  commit,
  cwd,
  side,
  trigger,
}: {
  commit: CommitSummary;
  /** The checkout the commit is read from (its remote gives the links). */
  cwd: string;
  side?: 'right' | 'left';
  trigger: (handlers: HoverCardTrigger) => ReactElement;
}) {
  const [peeked, setPeeked] = useState(false);
  const links = useCommitLinks(cwd, commit.hash, peeked);
  const when = formatRelativeTime(commit.authorDate, Date.now() / 1000);
  return (
    <HoverCard
      trigger={trigger}
      side={side}
      onOpen={() => setPeeked(true)}
      footer={
        <div className="type-caption flex items-center gap-2">
          <CommitHash hash={commit.shortHash} url={links.commitUrl} />
          <span>·</span>
          <CommitAuthor name={commit.authorName} url={links.authorUrl} className="truncate" />
          <span>·</span>
          <span className="tabular-nums">{when}</span>
          <span className="ml-auto">
            <LineStats add={commit.additions} del={commit.deletions} />
          </span>
        </div>
      }
    >
      <div className="type-heading wrap-break-word">{commit.subject || '(no subject)'}</div>
      {commit.body && <div className="type-body whitespace-pre-wrap">{commit.body}</div>}
    </HoverCard>
  );
}

/** A commit's hash, a link to its forge page when it has one. */
export function CommitHash({ hash, url }: { hash: string; url: string | null }) {
  return (
    <span className="tabular-nums">
      {url ? (
        <TextLink href={url} title="Open the commit on the remote">
          {hash}
        </TextLink>
      ) : (
        hash
      )}
    </span>
  );
}

/** A commit's author, a link to their forge profile when it is known. */
export function CommitAuthor({
  name,
  url,
  className,
}: {
  name: string;
  url: string | null;
  className?: string;
}) {
  return (
    <span className={className}>
      {url ? (
        <TextLink href={url} title="Open the author's profile">
          {name}
        </TextLink>
      ) : (
        name
      )}
    </span>
  );
}
