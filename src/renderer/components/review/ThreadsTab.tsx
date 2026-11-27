import { useMemo, useState, type ReactNode } from 'react';
import { Pencil, Reply } from 'lucide-react';
import type { DiffComment, PrReview, PrReviewComment, PrReviewThread } from '../../../shared/types';
import { isPendingComment, usePrReviews } from '../../stores/prReviewStore';
import { CommentInputBar } from '../diffEditor/comments/CommentInputBar';
import { openFileAt } from '../diffEditor/openFileAt';
import {
  CommentFrame,
  DraftBadge,
  DraftComment,
  PostedComment,
} from '../diffEditor/prReview/PrComment';
import { PrThreadCard } from '../diffEditor/prReview/PrThreadCard';
import { isInlineThread } from '../diffEditor/prReview/prViewPolicy';
import {
  usePrThreadContext,
  type PrThreadContext,
} from '../diffEditor/prReview/usePrThreadContext';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DetailSection } from '../ui/DetailList';
import { Markdown } from '../ui/Markdown';
import { TextLink } from '../ui/TextLink';
import { Composer } from './DraftActions';
import { threadGroups, draftPlace, threadRange, type ThreadItem } from './outline';
import { useSectionOpen } from '../../lib/useSectionOpen';

type Navigate = (scope: string, path: string, commentId: string) => void;

/**
 * The Threads tab's Threads: every exchange with the author, each a thread
 * card (a lone comment is a thread of one). General (the PR's conversation,
 * with reactions and Reply, and the review's summary while it is a draft),
 * Unresolved (open threads, on the code or off it, with the person's draft
 * threads among them by file and line) and
 * Resolved (folded). A thread's card is the one drawn under its line
 * (`PrThreadCard`), its draft replies inside it.
 */
export function ThreadsTab({
  review,
  taskId,
  projectId,
  cwd,
  draftScope,
  comments,
  summary,
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
  onNavigate: Navigate;
}) {
  const groups = useMemo(() => threadGroups(review.threads, comments), [review, comments]);
  const general = useSectionOpen('threads.general', false);
  const unresolved = useSectionOpen('threads.unresolved', true);
  const resolved = useSectionOpen('threads.resolved', false);
  const context = usePrThreadContext({ review, projectId, cwd, taskId, draftScope });
  if (!context) return null;
  const generalCount = review.conversation.length + (summary ? 1 : 0);
  if (generalCount + groups.unresolved.length + groups.resolved.length === 0) {
    return <p className="type-caption px-2.5 pt-2">No threads yet.</p>;
  }
  return (
    <div>
      {generalCount > 0 && (
        <DetailSection title="General" summary={String(generalCount)} collapsible {...general}>
          <Cards>
            {summary && <SummaryCard text={summary} />}
            {review.conversation.map((c) => (
              <GeneralCard key={c.id} comment={c} context={context} />
            ))}
          </Cards>
        </DetailSection>
      )}
      {groups.unresolved.length > 0 && (
        <DetailSection
          title="Unresolved"
          summary={String(groups.unresolved.length)}
          collapsible
          {...unresolved}
        >
          <ThreadItems items={groups.unresolved} context={context} onNavigate={onNavigate} />
        </DetailSection>
      )}
      {groups.resolved.length > 0 && (
        <DetailSection
          title="Resolved"
          summary={String(groups.resolved.length)}
          collapsible
          {...resolved}
        >
          <ThreadItems items={groups.resolved} context={context} onNavigate={onNavigate} />
        </DetailSection>
      )}
    </div>
  );
}

/** The tab's cards, a column with room between them. */
function Cards({ children }: { children: ReactNode }) {
  return <div className="grid gap-2.5 px-2.5 pt-1 pb-3">{children}</div>;
}

/** A list of the tab's threads (posted ones with their draft replies, draft
 *  threads) as its cards; Finish review lists what posts with it too. */
export function ThreadItems({
  items,
  context,
  onNavigate,
  onOpened,
}: {
  items: ThreadItem[];
  context: PrThreadContext;
  onNavigate: Navigate;
  /** After a posted thread's place opened in the editor (Finish review
   *  closes then, as it does on `onNavigate`). */
  onOpened?: () => void;
}) {
  return (
    <Cards>
      {items.map((i) =>
        i.kind === 'posted' ? (
          <PostedThreadCard
            key={i.thread.id}
            thread={i.thread}
            context={context}
            onOpened={onOpened}
          />
        ) : (
          <DraftThreadCard
            key={i.draft.id}
            comment={i.draft}
            mentions={context.mentions}
            onNavigate={onNavigate}
          />
        ),
      )}
    </Cards>
  );
}

/** A thread's card, folded to start, naming where it sits; one on a line
 *  opens its file there (expanding the sidebar). The card lists its draft
 *  replies. */
function PostedThreadCard({
  thread,
  context,
  onOpened,
}: {
  thread: PrReviewThread;
  context: PrThreadContext;
  onOpened?: () => void;
}) {
  const line = isInlineThread(thread) ? thread.line : null;
  return (
    <PrThreadCard
      thread={thread}
      context={context}
      defaultOpen={false}
      showLocation
      onOpenLocation={
        line === null
          ? undefined
          : () => {
              openFileAt(thread.path, threadRange({ ...thread, line }));
              onOpened?.();
            }
      }
    />
  );
}

/** A draft thread, the person's (or the agent's), which the review will
 *  start: its one entry, the draft comment, where it sits (opens it there)
 *  and its text. */
function DraftThreadCard({
  comment: c,
  mentions,
  onNavigate,
}: {
  comment: DiffComment;
  mentions: readonly string[];
  onNavigate: Navigate;
}) {
  const place = draftPlace(c);
  return (
    <Card>
      <DraftComment
        draft={c}
        mentions={mentions}
        place={
          <span className="min-w-0 truncate">
            <TextLink title={c.filePath} onClick={() => onNavigate(c.viewScope, c.filePath, c.id)}>
              {place.name}
            </TextLink>
          </span>
        }
      />
    </Card>
  );
}

/**
 * A general comment, the PR's conversation: the comment and a Reply that
 * opens a composer (`@` mentions) whose Post reply posts at once (D225) —
 * no draft, not part of Finish review. A reply posting shows at the
 * conversation's end; a refused one leaves the composer with its text.
 */
function GeneralCard({ comment, context }: { comment: PrReviewComment; context: PrThreadContext }) {
  const [replying, setReplying] = useState(false);
  const posting = usePrReviews((s) => !!s.posting[comment.id]);
  const pending = isPendingComment(comment);
  const post = async (text: string) => {
    if (await context.replyGeneral(comment, text)) setReplying(false);
  };
  return (
    <Card>
      <div className="grid gap-3">
        <PostedComment comment={comment} context={context} />
        {replying ? (
          <Composer>
            <CommentInputBar
              lineRange={null}
              initialText=""
              placeholder="Reply… (@ to mention)"
              submitLabel="Post reply"
              mentions={context.mentions}
              busy={posting}
              onSubmit={(text) => void post(text)}
              onCancel={() => setReplying(false)}
            />
          </Composer>
        ) : (
          !pending && (
            <footer className="flex">
              <Button variant="secondary" size="sm" onClick={() => setReplying(true)}>
                <Reply size={14} strokeWidth={1.8} />
                Reply
              </Button>
            </footer>
          )
        )}
      </div>
    </Card>
  );
}

/** The review's summary while it is a draft: it posts with the review, as a
 *  general comment. Written in Finish review… (the column's footer). */
function SummaryCard({ text }: { text: string }) {
  return (
    <Card>
      <CommentFrame
        avatar={<Avatar name="You" icon={Pencil} />}
        name="Review summary"
        badge={<DraftBadge />}
      >
        <Markdown text={text} />
      </CommentFrame>
    </Card>
  );
}
