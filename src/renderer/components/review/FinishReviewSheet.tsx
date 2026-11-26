import { useEffect, useRef, useState, type RefObject } from 'react';
import { Bot, Check, Copy, Loader2, MessageSquare } from 'lucide-react';
import { toast } from '../ui/toast';
import type { DiffComment, PrReview, PrVerdict, PrWriteError } from '../../../shared/types';
import { usePrReviews } from '../../stores/prReviewStore';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Markdown } from '../ui/Markdown';
import { Modal, useModalClose } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { DraftActions, DraftEditor } from './DraftActions';
import { canPost, offeredVerdict, postLabel, VERDICT_LABELS } from './finishReview';
import { plural, providerName } from './labels';
import { groupByPath, lineLabel } from './outline';

interface Props {
  review: PrReview;
  projectId: string;
  cwd: string;
  taskId: string;
  /** The person's comments and replies for this PR: what posts. */
  comments: DiffComment[];
  /** The task's notes on this PR not yet sent: they stay local. */
  noteCount: number;
  onClose: () => void;
}

/**
 * Finish review: the one place a review posts. The verdict, the summary (the
 * review's PR-level comment, a stored draft the agent may have written), and
 * every comment and reply by file — editable, deletable, demotable — then a
 * button that says what posts where. Nothing posts from the keyboard.
 */
export function FinishReviewSheet(props: Props) {
  // Read when a close is asked for, which can come before a re-render.
  const posting = useRef(false);
  return (
    <Modal
      onClose={props.onClose}
      canClose={() => !posting.current}
      size="flex max-h-[88vh] w-[720px] max-w-[94vw] flex-col"
    >
      <Sheet {...props} posting={posting} />
    </Modal>
  );
}

function Sheet({
  review,
  projectId,
  cwd,
  taskId,
  comments,
  noteCount,
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
      <header className="grid gap-0.5 px-5 pt-5 pb-3">
        <h2 className="type-title truncate">Finish review of PR #{review.number}</h2>
        <p className="type-caption truncate" title={review.title}>
          {review.title}
        </p>
      </header>
      <div className="scrollbar-thin-hover grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 pb-4">
        {review.verdicts.length > 1 && (
          <label className="grid gap-1.5">
            <span className="type-label">Verdict</span>
            <Select
              value={verdict}
              onValueChange={setPicked}
              options={review.verdicts.map((v) => ({ value: v, label: VERDICT_LABELS[v] }))}
            />
          </label>
        )}
        <label className="grid gap-1.5">
          <span className="flex items-center gap-2">
            <span className="type-label flex-1">Summary</span>
            {summary?.author === 'agent' && (
              <span className="type-caption inline-flex items-center gap-1">
                <Bot size={14} strokeWidth={1.8} className="text-icon" />
                Drafted by the agent
              </span>
            )}
          </span>
          <Textarea
            value={body}
            onChange={(e) => setSummary(e.target.value)}
            // Keys stay in the field: no app shortcut fires, nothing posts.
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="A comment on the whole PR (optional)"
            autoGrow={{ minRows: 6, maxRows: 24 }}
          />
        </label>
        <section className="grid gap-2">
          <h3 className="type-heading">
            {comments.length > 0 ? plural(comments.length, 'comment') : 'No comments'}
          </h3>
          {groupByPath(comments).map(([path, list]) => (
            <div key={path} className="grid gap-1.5">
              <h4 className="type-subheading truncate" title={path}>
                {path}
              </h4>
              {list.map((c) => (
                <DraftCard key={c.id} comment={c} />
              ))}
            </div>
          ))}
          {noteCount > 0 && (
            <p className="type-caption">
              {noteCount} {noteCount === 1 ? 'note stays' : 'notes stay'} local.
            </p>
          )}
        </section>
      </div>
      <footer className="grid gap-2 border-t border-line px-5 py-3">
        {error && <WriteError {...error} provider={review.provider} />}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy || !canPost(toPost)} onClick={() => void post()}>
            {busy && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
            {postLabel(review.provider, toPost)}
          </Button>
        </div>
      </footer>
    </>
  );
}

/** One comment or reply as it will post: where, who drafted it, its text. */
function DraftCard({ comment: c }: { comment: DiffComment }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <DraftEditor comment={c} onDone={() => setEditing(false)} />;
  return (
    <div className="grid gap-1 rounded-lg border border-line px-3 py-2">
      <div className="flex items-center gap-1.5">
        <MessageSquare size={14} strokeWidth={1.8} className="text-icon" />
        <span className="type-caption min-w-0 flex-1 truncate tabular-nums">
          {c.replyTo ? `Reply · ${lineLabel(c)}` : lineLabel(c)}
        </span>
        {c.author === 'agent' && <Badge size="sm">Agent</Badge>}
        <DraftActions comment={c} onEdit={() => setEditing(true)} />
      </div>
      <div className="type-body">
        <Markdown text={c.text} />
      </div>
    </div>
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
