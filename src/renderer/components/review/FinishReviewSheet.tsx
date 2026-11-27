import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Bot, Check, Copy, Loader2 } from 'lucide-react';
import { toast } from '../ui/toast';
import type { DiffComment, PrReview, PrVerdict, PrWriteError } from '../../../shared/types';
import { prScope } from '../../../shared/prScope';
import { usePrReviews } from '../../stores/prReviewStore';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import { usePrThreadContext } from '../diffEditor/prReview/usePrThreadContext';
import { Button } from '../ui/Button';
import { DetailItem, DetailList } from '../ui/DetailList';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { useModalClose } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { ThreadItems } from './ThreadsTab';
import { canPost, offeredVerdict, postingItems, postLabel, VERDICT_LABELS } from './finishReview';
import { plural, providerName } from './labels';

interface Props {
  review: PrReview;
  projectId: string;
  cwd: string;
  taskId: string;
  /** The person's comments and replies for this PR: what posts. */
  comments: DiffComment[];
  /** The task's notes on this PR not yet sent: they stay local. */
  noteCount: number;
  /** Show a draft where it was written (closes the sheet). */
  onNavigate: (scope: string, path: string, commentId: string) => void;
  onClose: () => void;
}

/**
 * Finish review: the one place a review posts. Two columns: on the left what
 * the review is (the PR, what posts where), the verdict and the summary (the
 * review's PR-level comment, a stored draft the agent may have written); on
 * the right every thread a comment or reply of the review posts in, as the
 * Threads tab draws them (threads fold), scrolling on its own. Then a button that says what
 * posts where. Nothing posts from the keyboard.
 */
export function FinishReviewSheet(props: Props) {
  // Read when a close is asked for, which can come before a re-render.
  const posting = useRef(false);
  return (
    <Dialog size="nav" onClose={props.onClose} canClose={() => !posting.current}>
      <Sheet {...props} posting={posting} />
    </Dialog>
  );
}

function Sheet({
  review,
  projectId,
  cwd,
  taskId,
  comments,
  noteCount,
  onNavigate,
  posting,
}: Props & { posting: RefObject<boolean> }) {
  const close = useModalClose();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<PrVerdict>('comment');
  const verdict = offeredVerdict(review.verdicts, picked);
  const { summary, setSummary } = useTaskReview(taskId, review);
  const body = summary?.body ?? '';
  const [error, setError] = useState<{ error: PrWriteError; posted: number } | null>(null);
  const toPost = { comments: comments.length, summary: body, verdict };
  const forge = providerName(review.provider);
  const replies = comments.filter((c) => c.replyTo).length;
  const items = useMemo(() => postingItems(review.threads, comments), [review, comments]);
  const context = usePrThreadContext({
    review,
    projectId,
    cwd,
    taskId,
    draftScope: prScope(review.provider, review.number),
  });

  async function post() {
    posting.current = true;
    setBusy(true);
    setError(null);
    const r = await usePrReviews.getState().submit(projectId, cwd, taskId, review, verdict, body);
    posting.current = false;
    setBusy(false);
    if (r.ok) {
      toast.success('Review posted');
      close();
    } else {
      setError({ error: r.error, posted: r.posted ?? 0 });
    }
  }

  return (
    <>
      <DialogHeader
        title={`Finish review of PR #${review.number}`}
        description={<span title={review.title}>{review.title}</span>}
        closeDisabled={busy}
      />
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-thin-hover grid w-90 shrink-0 content-start gap-5 overflow-y-auto px-5 pt-1 pb-5">
          <DetailList>
            <DetailItem label="Posts to">{forge}</DetailItem>
            <DetailItem label="Author">{review.author}</DetailItem>
            <DetailItem label="Into" title={`${review.headRef} → ${review.baseRef}`}>
              {review.baseRef}
            </DetailItem>
            <DetailItem label="Threads">
              <span className="tabular-nums">
                {[
                  comments.length > replies && plural(comments.length - replies, 'new thread'),
                  replies > 0 && (replies === 1 ? '1 reply' : `${replies} replies`),
                ]
                  .filter(Boolean)
                  .join(', ') || 'None'}
              </span>
            </DetailItem>
            {noteCount > 0 && (
              <DetailItem label="Notes">
                <span className="tabular-nums">{noteCount} stay local</span>
              </DetailItem>
            )}
          </DetailList>
          {review.verdicts.length > 1 && (
            <Field label="Verdict">
              <Select
                value={verdict}
                onValueChange={setPicked}
                options={review.verdicts.map((v) => ({ value: v, label: VERDICT_LABELS[v] }))}
              />
            </Field>
          )}
          <Field
            label="Summary"
            hint={{
              title: 'Summary',
              body: `A comment on the whole PR, posted with the review on ${forge}.`,
            }}
            trailing={
              summary?.author === 'agent' && (
                <span className="inline-flex items-center gap-1">
                  <Bot size={14} strokeWidth={1.8} className="text-icon" />
                  Drafted by the agent
                </span>
              )
            }
          >
            <Textarea
              value={body}
              onChange={(e) => setSummary(e.target.value)}
              // Keys stay in the field: no app shortcut fires, nothing posts.
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="A comment on the whole PR (optional)"
              autoGrow={{ minRows: 6, maxRows: 24 }}
            />
          </Field>
        </div>
        <section
          aria-label="Threads that post"
          className="flex min-w-0 flex-1 flex-col rounded-l-xl bg-dialog-well"
        >
          <h3 className="type-heading shrink-0 px-5 pt-4 pb-2">
            {items.length > 0 ? plural(items.length, 'thread') : 'No threads'}
          </h3>
          <div className="scrollbar-thin-hover min-h-0 flex-1 overflow-y-auto px-2.5">
            {context && items.length > 0 ? (
              <ThreadItems
                items={items}
                context={context}
                onNavigate={(scope, path, id) => {
                  onNavigate(scope, path, id);
                  close();
                }}
              />
            ) : (
              <p className="type-caption px-2.5">Only the verdict and summary post.</p>
            )}
          </div>
        </section>
      </div>
      <DialogFooter status={error && <WriteError {...error} provider={review.provider} />}>
        <Button variant="ghost" disabled={busy} onClick={close}>
          Cancel
        </Button>
        <Button disabled={busy || !canPost(toPost)} onClick={() => void post()}>
          {busy && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {postLabel(review.provider, toPost)}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Why the post failed, and what reached the PR before it did. */
function WriteError({
  error,
  provider,
  posted,
}: {
  error: PrWriteError;
  provider: PrReview['provider'];
  /** Drafts that reached the PR before the error; the rest are still drafts. */
  posted: number;
}) {
  const kept =
    posted > 0
      ? `${posted} ${posted === 1 ? 'comment was' : 'comments were'} posted; the rest are kept as drafts.`
      : 'Your drafts are kept.';
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  if (error.kind === 'pending-review') {
    return (
      <p className="text-xs text-state-fail">
        You have a pending review on GitHub; submit or discard it there, then try again. {kept}
      </p>
    );
  }
  if (error.kind === 'other') {
    return (
      <p className="text-xs break-words text-state-fail">
        {error.message} {posted > 0 ? kept : ''}
      </p>
    );
  }
  return (
    <div className="grid gap-1 text-xs">
      <span className="text-state-fail">
        {providerName(provider)} refused the write: the token can&apos;t write to this PR. {kept}
      </span>
      <div className="flex items-center gap-1 rounded-md bg-well px-2 py-1">
        <span className="flex-1 font-mono break-words text-ink-2">{error.fix}</span>
        <IconButton
          title="Copy"
          size="sm"
          onClick={() => {
            void window.electronAPI.clipboardWriteText(error.fix);
            setCopied(true);
          }}
        >
          {copied ? <Check size={14} strokeWidth={1.8} /> : <Copy size={14} strokeWidth={1.8} />}
        </IconButton>
      </div>
    </div>
  );
}
