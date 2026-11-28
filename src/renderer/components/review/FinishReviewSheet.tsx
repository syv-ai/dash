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
import { LineStats } from '../ui/LineStats';
import { prStateIcon, prStatusText } from '../ui/prStatusColors';
import { TextLink } from '../ui/TextLink';
import { useModalClose } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { ThreadItems } from './ThreadsTab';
import { ChecksRollupIcon } from './ChecksRollupIcon';
import {
  canPost,
  draftsLine,
  offeredVerdict,
  ownReviewLine,
  postingItems,
  postLabel,
  threadsLineShort,
  VERDICT_LABELS,
} from './finishReview';
import { diffTotals, plural, providerName } from './labels';
import { checksRollup, checksSummary } from './outline';
import { Branch } from './ReviewHeader';

interface Props {
  review: PrReview;
  /** The project's git remote: where branch links point. */
  remote: string | null;
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

const PR_STATE_LABELS: Record<PrReview['state'], string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

/**
 * Finish review: the one place a review posts. Two columns: on the left what
 * the review is (the PR and its branches, linked; its state, checks and
 * changes; the person's last review; its threads and the drafts that post),
 * the verdict and the summary (the review's PR-level comment, a stored draft
 * the agent may have written), which takes the column's height left; on
 * the right every thread a comment or reply of the review posts in, as the
 * Threads tab draws them (threads fold), on a sheet that scrolls on its own.
 * Then a button that says what posts where. Nothing posts from the keyboard.
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
  remote,
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
    if (r.ok && r.heldBack) {
      const n = r.heldBack;
      // With nothing else to post, the review posted nothing at all.
      const nothing = !r.posted && verdict === 'comment' && !body.trim();
      toast.warning(
        `${nothing ? 'Nothing was posted' : 'Review posted'}. ${n} ${n === 1 ? 'comment was' : 'comments were'} kept as drafts`,
        {
          description: `Written on an older version of the PR, ${n === 1 ? 'its lines' : 'their lines'} may be other code now. Check ${n === 1 ? 'it' : 'them'} (marked "PR moved"), then post again.`,
        },
      );
      close();
    } else if (r.ok) {
      toast.success('Review posted');
      close();
    } else {
      setError({ error: r.error, posted: r.posted ?? 0 });
    }
  }

  const StateIcon = prStateIcon(review.state);
  const totals = diffTotals(review.files);
  const checks = checksSummary(review.checks);

  return (
    <>
      <DialogHeader title={`Finish review of PR #${review.number}`} closeDisabled={busy} />
      <div className="flex min-h-0 flex-1">
        {/* A column whose Summary takes the height left, its bottom edge on
            the threads pane's. */}
        <div className="scrollbar-thin-hover flex w-90 shrink-0 flex-col gap-5 overflow-y-auto px-5 pt-1">
          <DetailList>
            <DetailItem label="Pull request" title={review.title}>
              <TextLink href={review.url} title={`Open on ${forge}`}>
                <span className="tabular-nums">#{review.number}</span> {review.title}
              </TextLink>
            </DetailItem>
            <DetailItem label="State">
              <span className="inline-flex items-center gap-1.5">
                <StateIcon
                  size={14}
                  strokeWidth={1.8}
                  className={prStatusText(review.state)}
                  aria-hidden
                />
                {PR_STATE_LABELS[review.state]}
              </span>
            </DetailItem>
            <DetailItem label="Author">
              {review.authorUrl ? (
                <TextLink href={review.authorUrl} title={`${review.author}'s profile`}>
                  {review.author}
                </TextLink>
              ) : (
                review.author
              )}
            </DetailItem>
            <DetailItem label="Branches" title={`${review.headRef} into ${review.baseRef}`}>
              <Branch remote={remote} name={review.baseRef} /> ←{' '}
              <Branch remote={remote} name={review.headRef} />
            </DetailItem>
            <DetailItem label="Checks">
              {checks ? (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <ChecksRollupIcon ci={checksRollup(review.checks)!} />
                  {checks}
                </span>
              ) : (
                'None'
              )}
            </DetailItem>
            <DetailItem label="Changes">
              <span className="tabular-nums">
                {plural(totals.files, 'file')}
                {(totals.additions > 0 || totals.deletions > 0) && ', '}
                <LineStats add={totals.additions} del={totals.deletions} />
              </span>
            </DetailItem>
            <DetailItem label="Commits">
              <span className="tabular-nums">{review.commits}</span>
            </DetailItem>
            <DetailItem label="Your review">
              <span className="tabular-nums">{ownReviewLine(review.viewerReview, Date.now())}</span>
            </DetailItem>
            <DetailItem label="Threads">
              <span className="tabular-nums">{threadsLineShort(review.threads)}</span>
            </DetailItem>
            <DetailItem label="Drafts">
              <span className="tabular-nums">{draftsLine(comments)}</span>
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
            fill
            className="min-h-40"
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
              className="h-full resize-none"
            />
          </Field>
        </div>
        {/* A sheet inside the dialog's 20px sides, as the left column is: its
            right edge on the footer's button's, its top on the column's. */}
        <section
          aria-label="Threads that post"
          className="mt-1 mr-5 flex min-w-0 flex-1 flex-col rounded-xl bg-dialog-well"
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
                onOpened={close}
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
