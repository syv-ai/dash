import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Bot, CircleCheck, Reply, RotateCcw } from 'lucide-react';
import type { DiffComment, PrReviewThread } from '../../../../shared/types';
import { replyAnchor } from '../../../../shared/diffComments';
import { useCommentsStore } from '../../../stores/commentsStore';
import { Composer } from '../../review/DraftActions';
import { threadHeadline, threadPlace, threadTally } from '../../review/outline';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { DisclosureButton } from '../../ui/DisclosureButton';
import { IconButton } from '../../ui/IconButton';
import { TextLink } from '../../ui/TextLink';
import { CommentInputBar } from '../comments/CommentInputBar';
import { DraftComment, PostedComment } from './PrComment';
import type { PrThreadContext } from './usePrThreadContext';

const EMPTY: DiffComment[] = [];

/**
 * One PR review thread, the same card under its line in the editor and in
 * the Comments tab: a header (fold, status, where, Ask agent), then its
 * posted comments, the task's draft replies (marked not posted), a reply
 * box, and Reply / Resolve. Folded, it shows who started it, its first line
 * and how many replies follow, and a Reply that opens it on the reply box.
 * Reply is always there: disabled, saying why, while no task owns drafts.
 */
export function PrThreadCard({
  thread,
  context,
  defaultOpen,
  elevated = false,
  showLocation = false,
  onOpenLocation,
}: {
  thread: PrReviewThread;
  context: PrThreadContext;
  /** Open on first render; a resolved thread usually starts folded. */
  defaultOpen: boolean;
  /** Drawn over the code: the floating shadow. */
  elevated?: boolean;
  /** Listed off the code: the header names its file and line. */
  showLocation?: boolean;
  /** Opens its file at its line, from the named place (a thread on a line). */
  onOpenLocation?: () => void;
}) {
  const { draftScope, replyBlocked, replyPoster, mentions } = context;
  const [open, setOpen] = useState(defaultOpen);
  const [replying, setReplying] = useState(false);
  const drafts = useCommentsStore(
    useShallow((s) =>
      // By thread, across files: a reply's own path doesn't matter (an agent
      // may give a slightly different one), only the thread it answers.
      draftScope
        ? Object.values(s.byFile)
            .flat()
            .filter((c) => c.replyTo === thread.id && c.viewScope === draftScope)
        : EMPTY,
    ),
  );
  const first = thread.comments[0];

  const addReply = (text: string) => {
    if (!draftScope) return;
    useCommentsStore.getState().addComment({
      ...replyAnchor(thread),
      text,
      viewScope: draftScope,
      replyTo: thread.id,
      kind: 'comment',
    });
    setReplying(false);
  };

  /** Open the card on its reply box (the folded header's Reply). */
  const startReply = () => {
    setOpen(true);
    setReplying(true);
  };

  const author = first?.author ?? 'ghost';
  const place = showLocation ? threadPlace(thread).name : null;
  const tally = [threadTally(thread, drafts.length), place].filter(Boolean).join(' · ');
  return (
    <Card elevated={elevated} padding="none" aria-label={`Thread by ${author}`}>
      <header className="flex min-w-0 items-start gap-1.5 p-1.5">
        <DisclosureButton open={open} onOpenChange={setOpen}>
          {open ? (
            <span className="flex h-7 items-center">
              <ThreadStatus resolved={thread.resolved} />
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 items-start gap-2.5 pb-1">
              <span className="flex h-7 items-center">
                <Avatar name={author} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex h-7 min-w-0 items-center gap-2">
                  <span className="type-heading min-w-0 truncate">{author}</span>
                  {tally && <span className="type-caption truncate tabular-nums">{tally}</span>}
                </span>
                <span className="type-body line-clamp-2 wrap-break-word">
                  {threadHeadline(thread) || '(no text)'}
                </span>
              </span>
            </span>
          )}
        </DisclosureButton>
        {open && place && (
          <span className="type-caption flex h-8 min-w-0 items-center truncate" title={thread.path}>
            {onOpenLocation ? (
              <TextLink look="quiet" title={`Open ${thread.path} there`} onClick={onOpenLocation}>
                {place}
              </TextLink>
            ) : (
              place
            )}
          </span>
        )}
        {!open && (
          <IconButton
            size="sm"
            className="mt-1"
            title="Reply"
            description={replyBlocked ?? 'Open the thread and write a reply'}
            disabled={!!replyBlocked}
            onClick={startReply}
          >
            <Reply size={14} strokeWidth={1.8} />
          </IconButton>
        )}
        <IconButton
          size="sm"
          className="mt-1"
          title="Ask agent"
          description="Type this thread into the task's prompt"
          onClick={() => context.ask(thread)}
        >
          <Bot size={14} strokeWidth={1.8} />
        </IconButton>
      </header>
      {open && (
        <div className="grid gap-4 border-t border-line px-4 pt-3.5 pb-3">
          {thread.comments.map((c) => (
            <PostedComment key={c.id} comment={c} context={context} />
          ))}
          {drafts.map((d) => (
            <div key={d.id} className="rounded-lg border border-line bg-well p-3">
              <DraftComment draft={d} poster={replyPoster} mentions={mentions} />
            </div>
          ))}
          {replying && (
            <Composer>
              <CommentInputBar
                lineRange={null}
                initialText=""
                placeholder="Reply… (@ to mention)"
                submitLabel="Save draft"
                mentions={mentions}
                onSubmit={addReply}
                onCancel={() => setReplying(false)}
              />
            </Composer>
          )}
          <footer className="flex flex-wrap items-center gap-1.5">
            {!replying && (
              <Button
                variant="secondary"
                size="sm"
                disabledReason={replyBlocked}
                onClick={() => setReplying(true)}
              >
                <Reply size={14} strokeWidth={1.8} />
                Reply
              </Button>
            )}
            <span className="flex-1" />
            {thread.resolved ? (
              <Button variant="ghost" size="sm" onClick={() => context.setResolved(thread, false)}>
                <RotateCcw size={14} strokeWidth={1.8} />
                Reactivate
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => context.setResolved(thread, true)}
              >
                <CircleCheck size={14} strokeWidth={1.8} />
                Resolve
              </Button>
            )}
          </footer>
        </div>
      )}
    </Card>
  );
}

/** Open or Resolved, in words with its icon: neutral, as every non-agent state. */
function ThreadStatus({ resolved }: { resolved: boolean }) {
  return resolved ? (
    <span className="type-label inline-flex items-center gap-1">
      <CircleCheck size={14} strokeWidth={1.8} className="text-icon" />
      Resolved
    </span>
  ) : (
    <span className="type-label">Open thread</span>
  );
}
