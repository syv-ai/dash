import { useState } from 'react';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import type { PrReview, PrReviewThread } from '../../../shared/types';
import { usePrReviews, type ReplyPoster } from '../../stores/prReviewStore';
import { buildReviewPrompt } from '../../utils/agentPrompt';
import { typeIntoTask } from '../../utils/typeIntoTask';
import { openFileAt } from '../diffEditor/openFileAt';
import { PrThreadCard } from '../diffEditor/prReview/PrThreadCard';
import { isInlineThread } from '../diffEditor/prReview/prViewPolicy';
import { CountBadge } from '../ui/CountBadge';
import { DetailSection } from '../ui/DetailList';
import { Expandable } from '../ui/Expandable';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { communicationCounts } from './labels';
import { threadGroups, threadHeadline, threadPlace } from './outline';
import { rowAction, rowKeys } from './rowAction';

interface ThreadActions {
  review: PrReview;
  /** The PR's draft scope; null without a task to own replies. */
  draftScope: string | null;
  /** Per thread id, the person's draft replies. */
  replyDrafts: ReadonlyMap<string, number>;
  onAsk: (thread: PrReviewThread) => void;
  onSetResolved: (thread: PrReviewThread, resolved: boolean) => void;
  /** On the own PR: where draft replies post from. */
  replyPoster: ReplyPoster | null;
}

/**
 * The PR's threads: open ones on their lines, open ones off the code
 * (outdated, whole-file, removed lines), and resolved ones (folded). A row on
 * a line goes there; one off the code unfolds its card in place.
 */
export function ReviewThreads({
  review,
  taskId,
  projectId,
  cwd,
  draftScope,
  replyDrafts,
}: {
  review: PrReview;
  taskId: string;
  projectId: string;
  cwd: string;
  draftScope: string | null;
  replyDrafts: ReadonlyMap<string, number>;
}) {
  if (review.threads.length === 0) return null;
  const groups = threadGroups(review.threads);
  const actions: ThreadActions = {
    review,
    draftScope,
    replyDrafts,
    replyPoster: review.viewerIsAuthor && draftScope ? { projectId, cwd, taskId, review } : null,
    onAsk: (t) => void typeIntoTask(taskId, buildReviewPrompt(review, [t])),
    onSetResolved: (t, resolved) =>
      void usePrReviews
        .getState()
        .setResolved(projectId, cwd, review, t.id, resolved)
        .then((r) => {
          if (r.ok) return;
          const why = r.error.kind === 'other' ? r.error.message : 'the PR refused the change';
          toast.error(`Could not ${resolved ? 'resolve' : 'reactivate'} the thread: ${why}`);
        }),
  };
  return (
    <DetailSection
      title="Threads"
      summary={communicationCounts({ open: groups.unresolved.length + groups.offCode.length })}
      collapsible
    >
      <ThreadGroup title="Unresolved" threads={groups.unresolved} {...actions} />
      <ThreadGroup title="Outdated or off the code" threads={groups.offCode} {...actions} />
      {groups.resolved.length > 0 && (
        <Expandable label={`Resolved · ${groups.resolved.length}`}>
          <ThreadList threads={groups.resolved} {...actions} />
        </Expandable>
      )}
    </DetailSection>
  );
}

function ThreadGroup({
  title,
  threads,
  ...actions
}: { title: string; threads: PrReviewThread[] } & ThreadActions) {
  if (threads.length === 0) return null;
  return (
    <div className="grid gap-px">
      <h4 className="type-subheading px-2.5 pt-1">{title}</h4>
      <ThreadList threads={threads} {...actions} />
    </div>
  );
}

function ThreadList({ threads, ...actions }: { threads: PrReviewThread[] } & ThreadActions) {
  return (
    <div className="grid gap-px">
      {threads.map((t) => (
        <ThreadRow key={t.id} thread={t} {...actions} />
      ))}
    </div>
  );
}

/** A thread's row: its first line, who wrote it, where, its replies, and
 *  "Ask agent". */
function ThreadRow({
  thread,
  review,
  draftScope,
  replyDrafts,
  onAsk,
  onSetResolved,
  replyPoster,
}: { thread: PrReviewThread } & ThreadActions) {
  const [unfolded, setUnfolded] = useState(false);
  const inline = isInlineThread(thread);
  const replies = thread.comments.length - 1;
  const drafts = replyDrafts.get(thread.id) ?? 0;
  const author = thread.comments[0]?.author ?? 'ghost';
  const place = threadPlace(thread);
  // The file and line stay whole; who, the replies and the folder truncate.
  const rest = [
    `@${author}`,
    replies > 0 && `${replies} ${replies === 1 ? 'reply' : 'replies'}`,
    place.dir,
  ]
    .filter(Boolean)
    .join(' · ');
  const meta = (
    <span className="flex min-w-0 gap-1" title={`${thread.path} · @${author}`}>
      <span className="shrink-0 text-ink-2">{place.name}</span>
      <span className="min-w-0 truncate">· {rest}</span>
    </span>
  );
  const open = () => {
    if (!inline || thread.line === null) {
      setUnfolded((u) => !u);
      return;
    }
    const line = thread.line;
    openFileAt(thread.path, {
      startLineNumber: thread.startLine ?? line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: 1,
    });
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
        description={meta}
        trailing={
          <>
            {drafts > 0 && <CountBadge count={drafts} title="Your draft replies" />}
            <IconButton size="sm" title="Ask agent" onClick={rowAction(() => onAsk(thread))}>
              <Bot size={14} strokeWidth={1.8} />
            </IconButton>
          </>
        }
        onClick={open}
        onKeyDown={rowKeys(open)}
      >
        {threadHeadline(thread) || '(no text)'}
      </ListRow>
      {unfolded && (
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
      )}
    </>
  );
}
