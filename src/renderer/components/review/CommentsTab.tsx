import { useMemo, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import type { DiffComment, PrReview, PrReviewThread } from '../../../shared/types';
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
import { Card } from '../ui/Card';
import { DetailSection } from '../ui/DetailList';
import { Markdown } from '../ui/Markdown';
import { TextLink } from '../ui/TextLink';
import { commentGroups, draftPlace, threadRange, type CommentItem } from './outline';
import { useSectionOpen } from './useSectionOpen';

type Navigate = (scope: string, path: string, commentId: string) => void;

/**
 * The Comments tab's Comments: every exchange with the author, each a card.
 * General (the PR's conversation, with reactions, and the review's summary
 * while it is a draft), Unresolved (open threads, on the code or off it,
 * with the person's draft comments among them by file and line) and
 * Resolved (folded). A thread's card is the one drawn under its line
 * (`PrThreadCard`), its draft replies inside it.
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
  onNavigate: Navigate;
}) {
  const groups = useMemo(() => commentGroups(review.threads, comments), [review, comments]);
  const general = useSectionOpen('comments.general', false);
  const unresolved = useSectionOpen('comments.unresolved', true);
  const resolved = useSectionOpen('comments.resolved', false);
  const context = usePrThreadContext({ review, projectId, cwd, taskId, draftScope });
  if (!context) return null;
  const generalCount = review.conversation.length + (summary ? 1 : 0);
  if (generalCount + groups.unresolved.length + groups.resolved.length === 0) {
    return <p className="type-caption px-2.5 pt-2">No comments yet.</p>;
  }
  return (
    <div>
      {generalCount > 0 && (
        <DetailSection title="General" summary={String(generalCount)} collapsible {...general}>
          <Cards>
            {summary && <SummaryCard text={summary} onFinish={onFinish} />}
            {review.conversation.map((c) => (
              <Card key={c.id}>
                <PostedComment comment={c} context={context} />
              </Card>
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
          <Items items={groups.unresolved} context={context} onNavigate={onNavigate} />
        </DetailSection>
      )}
      {groups.resolved.length > 0 && (
        <DetailSection
          title="Resolved"
          summary={String(groups.resolved.length)}
          collapsible
          {...resolved}
        >
          <Items items={groups.resolved} context={context} onNavigate={onNavigate} />
        </DetailSection>
      )}
    </div>
  );
}

/** The tab's cards, a column with room between them. */
function Cards({ children }: { children: ReactNode }) {
  return <div className="grid gap-2.5 px-2.5 pt-1 pb-3">{children}</div>;
}

function Items({
  items,
  context,
  onNavigate,
}: {
  items: CommentItem[];
  context: PrThreadContext;
  onNavigate: Navigate;
}) {
  return (
    <Cards>
      {items.map((i) =>
        i.kind === 'thread' ? (
          <ThreadCard key={i.thread.id} thread={i.thread} context={context} />
        ) : (
          <DraftCard
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
function ThreadCard({ thread, context }: { thread: PrReviewThread; context: PrThreadContext }) {
  const line = isInlineThread(thread) ? thread.line : null;
  return (
    <PrThreadCard
      thread={thread}
      context={context}
      defaultOpen={false}
      showLocation
      onOpenLocation={
        line === null ? undefined : () => openFileAt(thread.path, threadRange({ ...thread, line }))
      }
    />
  );
}

/** One of the person's (or the agent's) draft line comments, a thread the
 *  review will start: where it sits (opens it there) and its text. */
function DraftCard({
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
          <span className="type-caption min-w-0 truncate">
            <TextLink
              quiet
              title={c.filePath}
              onClick={() => onNavigate(c.viewScope, c.filePath, c.id)}
            >
              {place.name}
            </TextLink>
          </span>
        }
      />
    </Card>
  );
}

/** The review's summary while it is a draft: it posts with the review, as a
 *  general comment. Written in Finish review…, which it opens. */
function SummaryCard({ text, onFinish }: { text: string; onFinish?: () => void }) {
  return (
    <Card>
      <CommentFrame
        avatar={<Avatar name="You" icon={Pencil} dashed />}
        header={
          <>
            <span className="type-heading">Review summary</span>
            <DraftBadge />
          </>
        }
        footer={
          onFinish ? (
            <TextLink onClick={onFinish}>Edit in Finish review…</TextLink>
          ) : (
            <p className="type-caption">Posts when you finish the review.</p>
          )
        }
      >
        <Markdown text={text} />
      </CommentFrame>
    </Card>
  );
}
