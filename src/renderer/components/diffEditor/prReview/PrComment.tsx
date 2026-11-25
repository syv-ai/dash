import { useState, type ReactNode } from 'react';
import { Bot, ExternalLink, Pencil } from 'lucide-react';
import { formatTimeAgo } from '../../../../shared/relativeTime';
import type { DiffComment, PrReactionContent, PrReviewComment } from '../../../../shared/types';
import type { ReplyPoster } from '../../../stores/prReviewStore';
import { DraftActions, DraftEditor } from '../../review/DraftActions';
import { providerName } from '../../review/labels';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Badge';
import { IconButton } from '../../ui/IconButton';
import { Markdown } from '../../ui/Markdown';
import { TextLink } from '../../ui/TextLink';
import { PostReplyButtons } from './PostReplyButtons';
import { AddReaction, ReactionChips } from './Reactions';
import type { PrThreadContext } from './usePrThreadContext';

/**
 * One comment's layout, posted or draft alike: the avatar in a gutter, then
 * a header line (who · when · status, actions at its end), the body, and a
 * footer (reactions, or a draft's post buttons). Everything right of the
 * gutter shares one left edge.
 */
export function CommentFrame({
  avatar,
  header,
  actions,
  children,
  footer,
}: {
  avatar: ReactNode;
  header: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <div className="shrink-0">{avatar}</div>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex min-h-6 min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {header}
          </div>
          {actions && <div className="-my-0.5 flex shrink-0 items-center">{actions}</div>}
        </div>
        <div className="type-body">{children}</div>
        {footer && <div className="pt-1">{footer}</div>}
      </div>
    </div>
  );
}

/** A comment on the forge: who wrote it (to their profile where the forge
 *  has one), when, a link to it there, its text and its reactions. */
export function PostedComment({
  comment: c,
  context,
}: {
  comment: PrReviewComment;
  context: Pick<PrThreadContext, 'review' | 'react'>;
}) {
  const provider = context.review.provider;
  const at = Date.parse(c.createdAt);
  const react = (content: PrReactionContent, on: boolean) => context.react(c, content, on);
  return (
    <CommentFrame
      avatar={<Avatar name={c.author} />}
      header={
        <>
          <span className="type-heading min-w-0 truncate">
            {c.authorUrl ? (
              <TextLink quiet href={c.authorUrl} title={`${c.author} on ${providerName(provider)}`}>
                {c.author}
              </TextLink>
            ) : (
              c.author
            )}
          </span>
          {at > 0 && (
            <span className="type-caption whitespace-nowrap" title={new Date(at).toLocaleString()}>
              {formatTimeAgo(at / 1000, Date.now() / 1000)}
            </span>
          )}
        </>
      }
      actions={
        <>
          <AddReaction comment={c} provider={provider} onReact={react} />
          {c.url && (
            <IconButton
              size="sm"
              title={`Open on ${providerName(provider)}`}
              onClick={() => void window.electronAPI.openExternal(c.url)}
            >
              <ExternalLink size={14} strokeWidth={1.8} />
            </IconButton>
          )}
        </>
      }
      footer={c.reactions.length > 0 && <ReactionChips comment={c} onReact={react} />}
    >
      <Markdown text={c.body.trim() || '(no text)'} />
    </CommentFrame>
  );
}

/** "Draft · not posted": what marks a comment that is only here. */
export function DraftBadge() {
  return <Badge size="sm">Draft · not posted</Badge>;
}

/**
 * A comment that is only here: the person's or the agent's draft (a reply, a
 * line comment, the review's summary). A dashed avatar and "Draft · not
 * posted" tell it from a posted one; its actions edit, demote and delete; a
 * reply on the own PR posts from here, any other draft with Finish review.
 */
export function DraftComment({
  draft,
  poster = null,
  place,
  mentions,
}: {
  draft: DiffComment;
  /** On the own PR, a reply's Post reply / Post & resolve. */
  poster?: ReplyPoster | null;
  /** Where it sits, for a draft listed off the code ("a.ts:3"). */
  place?: ReactNode;
  mentions?: readonly string[];
}) {
  const [editing, setEditing] = useState(false);
  const agent = draft.author === 'agent';
  if (editing) {
    return <DraftEditor comment={draft} mentions={mentions} onDone={() => setEditing(false)} />;
  }
  const footer =
    poster && draft.replyTo ? (
      <div className="flex flex-wrap justify-end gap-1.5">
        <PostReplyButtons draft={draft} poster={poster} />
      </div>
    ) : (
      <p className="type-caption">Posts when you finish the review.</p>
    );
  return (
    <CommentFrame
      avatar={<Avatar name={agent ? 'Agent' : 'You'} icon={agent ? Bot : Pencil} dashed />}
      header={
        <>
          <span className="type-heading">{agent ? 'Agent' : 'You'}</span>
          <DraftBadge />
          {place}
        </>
      }
      actions={<DraftActions comment={draft} onEdit={() => setEditing(true)} />}
      footer={footer}
    >
      <Markdown text={draft.text} />
    </CommentFrame>
  );
}
