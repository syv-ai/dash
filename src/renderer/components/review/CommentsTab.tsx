import { useMemo, useState } from 'react';
import { Bot, CornerDownRight, ExternalLink, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { formatTimeAgo } from '../../../shared/relativeTime';
import type { DiffComment, PrReview, PrReviewComment, PrReviewThread } from '../../../shared/types';
import { usePrReviews, type ReplyPoster } from '../../stores/prReviewStore';
import { buildReviewPrompt } from '../../utils/agentPrompt';
import { typeIntoTask } from '../../utils/typeIntoTask';
import { openFileAt } from '../diffEditor/openFileAt';
import { PostReplyButtons } from '../diffEditor/prReview/PostReplyButtons';
import { PrThreadCard } from '../diffEditor/prReview/PrThreadCard';
import { isInlineThread } from '../diffEditor/prReview/prViewPolicy';
import { Badge } from '../ui/Badge';
import { DetailSection } from '../ui/DetailList';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { Markdown } from '../ui/Markdown';
import { DraftActions, DraftEditor } from './DraftActions';
import { providerName } from './labels';
import {
  commentGroups,
  draftPlace,
  threadHeadline,
  threadPlace,
  threadRange,
  type CommentItem,
} from './outline';
import { rowAction, rowKeys } from './rowAction';
import { useSectionOpen } from './useSectionOpen';

interface Actions {
  review: PrReview;
  /** The PR's draft scope; null without a task to own replies. */
  draftScope: string | null;
  /** On the own PR: where draft replies post from. */
  replyPoster: ReplyPoster | null;
  onAsk: (thread: PrReviewThread) => void;
  onSetResolved: (thread: PrReviewThread, resolved: boolean) => void;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}

/**
 * The Comments tab's Comments: every exchange with the author. General (the
 * PR's conversation, read-only, and the review's summary while it is a
 * draft), Unresolved (open threads, on the code or off it, with the person's
 * draft comments among them by file and line) and Resolved (folded). A
 * thread's draft replies sit under it.
 */
export function CommentsTab({
  review,
  taskId,
  projectId,
  cwd,
  draftScope,
  comments,
  summary,
  onFinish,
  onNavigate,
}: {
  review: PrReview;
  taskId: string;
  projectId: string;
  cwd: string;
  draftScope: string | null;
  /** The person's comments and replies for this PR (`reviewComments`). */
  comments: DiffComment[];
  /** The review's summary as drafted; '' with none. */
  summary: string;
  /** Open the Finish-review sheet, where the summary is edited. */
  onFinish?: () => void;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const groups = useMemo(() => commentGroups(review.threads, comments), [review, comments]);
  const general = useSectionOpen('comments.general', false);
  const unresolved = useSectionOpen('comments.unresolved', true);
  const resolved = useSectionOpen('comments.resolved', false);
  const actions: Actions = {
    review,
    draftScope,
    replyPoster: review.viewerIsAuthor && draftScope ? { projectId, cwd, taskId, review } : null,
    onAsk: (t) => void typeIntoTask(taskId, buildReviewPrompt(review, [t])),
    onSetResolved: (t, resolve) =>
      void usePrReviews
        .getState()
        .setResolved(projectId, cwd, review, t.id, resolve)
        .then((r) => {
          if (r.ok) return;
          const why = r.error.kind === 'other' ? r.error.message : 'the PR refused the change';
          toast.error(`Could not ${resolve ? 'resolve' : 'reactivate'} the thread: ${why}`);
        }),
    onNavigate,
  };
  const generalCount = review.conversation.length + (summary ? 1 : 0);
  if (generalCount + groups.unresolved.length + groups.resolved.length === 0) {
    return <p className="type-caption px-2.5 pt-2">No comments yet.</p>;
  }
  return (
    <div>
      {generalCount > 0 && (
        <DetailSection title="General" summary={String(generalCount)} collapsible {...general}>
          {summary && <SummaryRow text={summary} onFinish={onFinish} />}
          <Conversation comments={review.conversation} forge={providerName(review.provider)} />
        </DetailSection>
      )}
      {groups.unresolved.length > 0 && (
        <DetailSection
          title="Unresolved"
          summary={String(groups.unresolved.length)}
          collapsible
          {...unresolved}
        >
          <Items items={groups.unresolved} {...actions} />
        </DetailSection>
      )}
      {groups.resolved.length > 0 && (
        <DetailSection
          title="Resolved"
          summary={String(groups.resolved.length)}
          collapsible
          {...resolved}
        >
          <Items items={groups.resolved} {...actions} />
        </DetailSection>
      )}
    </div>
  );
}

function Items({ items, ...actions }: { items: CommentItem[] } & Actions) {
  return (
    <div className="grid gap-px">
      {items.map((i) =>
        i.kind === 'thread' ? (
          <ThreadRow key={i.thread.id} thread={i.thread} replies={i.replies} {...actions} />
        ) : (
          <DraftRow key={i.draft.id} comment={i.draft} onNavigate={actions.onNavigate} />
        ),
      )}
    </div>
  );
}

/** "a.ts:3 · @ann · 2 replies · src/x": the place's name whole, the rest
 *  truncating. */
function Meta({ name, rest, title }: { name: string; rest: string[]; title: string }) {
  const tail = rest.filter(Boolean).join(' · ');
  return (
    <span className="flex min-w-0 gap-1" title={title}>
      <span className="shrink-0 text-ink-2">{name}</span>
      {tail && <span className="min-w-0 truncate">· {tail}</span>}
    </span>
  );
}

/** A thread's row: its first line, who wrote it, where, its replies, and
 *  "Ask agent"; under it, the person's draft replies. A row on a line opens
 *  its file there (expanding the sidebar); one off the code unfolds its card
 *  in place. */
function ThreadRow({
  thread,
  replies: drafts,
  review,
  draftScope,
  replyPoster,
  onAsk,
  onSetResolved,
}: { thread: PrReviewThread; replies: DiffComment[] } & Actions) {
  const [unfolded, setUnfolded] = useState(false);
  const inline = isInlineThread(thread);
  const replies = thread.comments.length - 1;
  const author = thread.comments[0]?.author ?? 'ghost';
  const place = threadPlace(thread);
  const open = () => {
    if (!inline || thread.line === null) {
      setUnfolded((u) => !u);
      return;
    }
    openFileAt(thread.path, threadRange({ ...thread, line: thread.line }));
  };
  return (
    <>
      <ListRow
        as="div"
        role="button"
        tabIndex={0}
        size="sm"
        dimmed={thread.resolved}
        aria-expanded={inline ? undefined : unfolded}
        description={
          <Meta
            name={place.name}
            rest={[
              `@${author}`,
              replies > 0 ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : '',
              place.dir,
            ]}
            title={`${thread.path} · @${author}`}
          />
        }
        trailing={
          <IconButton size="sm" title="Ask agent" onClick={rowAction(() => onAsk(thread))}>
            <Bot size={14} strokeWidth={1.8} />
          </IconButton>
        }
        onClick={open}
        onKeyDown={rowKeys(open)}
      >
        {threadHeadline(thread) || '(no text)'}
      </ListRow>
      {unfolded ? (
        // The card lists the draft replies itself.
        <div className="py-1 pl-2.5">
          <PrThreadCard
            thread={thread}
            provider={review.provider}
            draftScope={draftScope}
            onSend={onAsk}
            onSetResolved={onSetResolved}
            replyPoster={replyPoster}
          />
        </div>
      ) : (
        drafts.map((d) => <ReplyRow key={d.id} draft={d} poster={replyPoster} />)
      )}
    </>
  );
}

/** One of the person's (or the agent's) draft replies, under its thread:
 *  edit, delete; on the own PR, Post reply / Post & resolve. */
function ReplyRow({ draft: c, poster }: { draft: DiffComment; poster: ReplyPoster | null }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <DraftEditor comment={c} onDone={() => setEditing(false)} />;
  return (
    <>
      <ListRow
        as="div"
        size="sm"
        indent={1}
        leading={<CornerDownRight size={14} strokeWidth={1.8} />}
        description={`Draft reply · ${c.author === 'agent' ? 'agent' : 'you'}`}
        trailing={<DraftActions comment={c} onEdit={() => setEditing(true)} />}
      >
        {c.text}
      </ListRow>
      {poster && (
        <div className="flex justify-end gap-1 px-2.5 pb-1">
          <PostReplyButtons draft={c} poster={poster} />
        </div>
      )}
    </>
  );
}

/** One of the person's draft line comments, a thread the review will start:
 *  where it sits and its text; edit, make it a note, delete. */
function DraftRow({
  comment: c,
  onNavigate,
}: {
  comment: DiffComment;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) return <DraftEditor comment={c} onDone={() => setEditing(false)} />;
  const place = draftPlace(c);
  const open = () => onNavigate(c.viewScope, c.filePath, c.id);
  return (
    <ListRow
      as="div"
      role="button"
      tabIndex={0}
      size="sm"
      leading={<MessageSquare size={14} strokeWidth={1.8} />}
      description={
        <Meta
          name={place.name}
          rest={[c.replyTo ? 'reply' : '', c.author === 'agent' ? 'by the agent' : '', place.dir]}
          title={c.filePath}
        />
      }
      trailing={
        <>
          <Badge size="sm">Draft</Badge>
          <DraftActions comment={c} onEdit={() => setEditing(true)} />
        </>
      }
      onClick={open}
      onKeyDown={rowKeys(open)}
    >
      {c.text}
    </ListRow>
  );
}

/** The review's summary while it is a draft: it posts with the review, as a
 *  general comment. Opens Finish review…, where it is written. */
function SummaryRow({ text, onFinish }: { text: string; onFinish?: () => void }) {
  const props = onFinish
    ? {
        as: 'div' as const,
        role: 'button',
        tabIndex: 0,
        title: 'Edit in Finish review…',
        onClick: onFinish,
        onKeyDown: rowKeys(onFinish),
      }
    : { as: 'div' as const };
  return (
    <ListRow
      size="sm"
      leading={<MessageSquare size={14} strokeWidth={1.8} />}
      description="Review summary"
      trailing={<Badge size="sm">Draft</Badge>}
      {...props}
    >
      {text}
    </ListRow>
  );
}

/** The PR's general conversation, oldest first, read-only. */
function Conversation({ comments, forge }: { comments: PrReviewComment[]; forge: string }) {
  if (comments.length === 0) return null;
  const now = Date.now() / 1000;
  return (
    <ol className="grid gap-2 pt-1">
      {comments.map((c) => (
        <li key={c.id} className="grid gap-1 rounded-lg border border-line px-3 py-2">
          <div className="flex items-baseline gap-2">
            <span className="type-subheading min-w-0 truncate">{c.author}</span>
            <span className="type-caption" title={c.createdAt}>
              {formatTimeAgo(Date.parse(c.createdAt) / 1000, now)}
            </span>
            <span className="flex-1" />
            {c.url && (
              <IconButton
                size="sm"
                title={`Open on ${forge}`}
                onClick={() => void window.electronAPI.openExternal(c.url)}
              >
                <ExternalLink size={14} strokeWidth={1.8} />
              </IconButton>
            )}
          </div>
          <div className="type-body">
            <Markdown text={c.body.trim()} />
          </div>
        </li>
      ))}
    </ol>
  );
}
