import { useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PrReview, PrVerdict, PrWriteError } from '../../../../shared/types';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Segmented } from '../../ui/Segmented';
import { usePrReviews } from '../../../stores/prReviewStore';
import { providerName } from './PrThreadCard';

const VERDICT_LABELS: Record<PrVerdict, string> = {
  comment: 'Comment',
  approve: 'Approve',
  request_changes: 'Request changes',
  approve_with_suggestions: 'With suggestions',
  wait_for_author: 'Wait for author',
  reject: 'Reject',
};

interface Props {
  review: PrReview;
  projectId: string;
  cwd: string;
  taskId: string;
  /** The task's drafts (comments and replies) for this PR. */
  draftCount: number;
}

function WriteError({ error, provider }: { error: PrWriteError; provider: PrReview['provider'] }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  if (error.kind === 'pending-review') {
    return (
      <div className="text-[11px] text-destructive">
        You have a pending review on GitHub; submit or discard it there, then try again. Your drafts
        are kept.
      </div>
    );
  }
  if (error.kind === 'other') {
    return <div className="text-[11px] text-destructive break-words">{error.message}</div>;
  }
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <span className="text-destructive">
        {providerName(provider)} refused the write: the token can&apos;t write to this PR. Your
        drafts are kept.
      </span>
      <div className="flex items-center gap-1 rounded-md bg-[hsl(var(--surface-1))] px-2 py-1">
        <span className="flex-1 font-mono text-fg-fade-85 break-words">{error.fix}</span>
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

/** The review panel's footer: verdict, summary, and Submit for the task's drafts. */
export function SubmitReview({ review, projectId, cwd, taskId, draftCount }: Props) {
  const [verdict, setVerdict] = useState<PrVerdict>('comment');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PrWriteError | null>(null);
  const offered = review.verdicts.includes(verdict) ? verdict : 'comment';
  const empty = draftCount === 0 && !body.trim() && offered === 'comment';

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await usePrReviews.getState().submit(projectId, cwd, taskId, review, offered, body);
    setBusy(false);
    if (r.ok) {
      setBody('');
      toast.success('Review submitted');
    } else {
      setError(r.error);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-edge/10 px-1.5 pt-2.5">
      {review.verdicts.length > 1 && (
        <Segmented
          size="sm"
          value={offered}
          onChange={setVerdict}
          options={review.verdicts.map((v) => ({ value: v, label: VERDICT_LABELS[v] }))}
        />
      )}
      <textarea
        data-diff-comment-input="true"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Summary (optional)"
        rows={3}
        className="w-full resize-none rounded-md border border-edge/10 bg-[hsl(var(--surface-1))] px-2 py-1.5 text-[12px] leading-relaxed placeholder:text-muted-fade-40 focus:outline-hidden"
      />
      {error && <WriteError error={error} provider={review.provider} />}
      <div className="flex items-center justify-end">
        <Button size="sm" disabled={busy || empty} onClick={() => void submit()}>
          {busy && <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />}
          {draftCount > 0
            ? `Submit ${draftCount} ${draftCount === 1 ? 'comment' : 'comments'}`
            : 'Submit review'}
        </Button>
      </div>
    </div>
  );
}
