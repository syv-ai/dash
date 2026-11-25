import { useState, type ReactNode } from 'react';
import { Bot, ExternalLink, Pencil } from 'lucide-react';
import { formatTimeAgo } from '../../../../shared/relativeTime';
import type { DiffComment, PrReactionContent, PrReviewComment } from '../../../../shared/types';
import { isPendingComment, type ReplyPoster } from '../../../stores/prReviewStore';
import { DraftActions, DraftEditor } from '../../review/DraftActions';
import { commentRole, commentRoleTip, providerName } from '../../review/labels';
import { Avatar } from '../../ui/Avatar';
import { Badge } from '../../ui/Badge';
import { IconButton } from '../../ui/IconButton';
import { Markdown } from '../../ui/Markdown';
import { TextLink } from '../../ui/TextLink';
import { Tooltip } from '../../ui/Tooltip';
import { PostReplyButtons } from './PostReplyButtons';
import { AddReaction, ReactionChips } from './Reactions';
import type { PrThreadContext } from './usePrThreadContext';

/**
 * One comment's layout, posted or draft alike: the avatar in a gutter, then
 * a name line (who, a badge saying what they are to the PR or that it isn't
 * posted; actions at its end), a quiet subtitle under it (when, or where a
 * draft sits), the body, and a footer (reactions, or a draft's post buttons).
 * Everything right of the gutter shares one left edge.
 */
export function CommentFrame({
  avatar,
  name,
  badge,
  subtitle,
  actions,
  children,
  footer,
}: {
  avatar: ReactNode;
  name: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <div className="shrink-0">{avatar}</div>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="grid min-w-0">
          <div className="flex min-h-6 min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="type-heading min-w-0 truncate">{name}</span>
              {badge}
            </div>
            {actions && <div className="-my-0.5 flex shrink-0 items-center">{actions}</div>}
          </div>
          {subtitle && <div className="type-caption flex min-w-0">{subtitle}</div>}
        </div>
        <div className="type-body">{children}</div>
        {footer && <div className="pt-1">{footer}</div>}
      </div>
    </div>
  );
}

/** A role badge's colour (D223): the author in the link blue, a reviewer in
 *  the merged-PR purple. */
const ROLE_TONES = { Author: 'link', Reviewer: 'merged' } as const;

/** A comment on the forge: who wrote it (to their profile where the forge
 *  has one) and what they are to the PR (`commentRole`), when, a link to it there, its text and its reactions. */
export function PostedComment({
  comment: c,
  context,
}: {
  comment: PrReviewComment;
  context: Pick<PrThreadContext, 'review' | 'react'>;
}) {
  const provider = context.review.provider;
  const at = Date.parse(c.createdAt);
  const role = commentRole(c.author, context.review);
  const react = (content: PrReactionContent, on: boolean) => context.react(c, content, on);
  return (
    <CommentFrame
      avatar={<Avatar name={c.author} />}
      name={
        c.authorUrl ? (
          <TextLink quiet href={c.authorUrl} title={`${c.author} on ${providerName(provider)}`}>
            {c.author}
          </TextLink>
        ) : (
          c.author
        )
      }
      badge={
        role && (
          <Tooltip content={{ title: commentRoleTip(role, c.author, context.review) }}>
            <Badge size="sm" tone={ROLE_TONES[role]}>
              {role}
            </Badge>
          </Tooltip>
        )
      }
      subtitle={
        at > 0 && (
          <span className="whitespace-nowrap" title={new Date(at).toLocaleString()}>
            {formatTimeAgo(at / 1000, Date.now() / 1000)}
          </span>
        )
      }
      actions={
        // A reply still posting has nothing on the forge to react to yet.
        !isPendingComment(c) && (
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
        )
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
      name={agent ? 'Agent' : 'You'}
      badge={<DraftBadge />}
      subtitle={place}
      actions={<DraftActions comment={draft} onEdit={() => setEditing(true)} />}
      footer={footer}
    >
      <Markdown text={draft.text} />
    </CommentFrame>
  );
}
