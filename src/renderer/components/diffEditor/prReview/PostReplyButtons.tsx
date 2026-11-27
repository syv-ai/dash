import { CheckCheck, Loader2, Send } from 'lucide-react';
import { toast } from '../../ui/toast';
import type { DiffComment, PrWriteError } from '../../../../shared/types';
import { usePrReviews, type ReplyPoster } from '../../../stores/prReviewStore';
import { Button } from '../../ui/Button';

const why = (e: PrWriteError): string =>
  e.kind === 'other'
    ? e.message
    : e.kind === 'scope'
      ? `the token can't write to this PR (${e.fix})`
      : 'you have a pending review on the PR';

/**
 * Post reply / Post & resolve for a draft reply on the own PR: the person's
 * gate for a reply (theirs or the agent's). Both disable while it posts; a
 * refusal toasts and keeps the draft. The thread card and the Threads tab
 * both use it.
 */
export function PostReplyButtons({ draft, poster }: { draft: DiffComment; poster: ReplyPoster }) {
  const posting = usePrReviews((s) => !!s.posting[draft.id]);
  const post = async (resolve: boolean) => {
    const r = await usePrReviews.getState().postReply(poster, draft, resolve);
    if (r.ok) toast.success(resolve ? 'Reply posted; thread resolved' : 'Reply posted');
    else if (r.posted) toast.error(`Reply posted, but the thread wasn't resolved: ${why(r.error)}`);
    else toast.error(`Could not post the reply: ${why(r.error)}`);
  };
  return (
    <>
      <Button size="sm" variant="secondary" disabled={posting} onClick={() => void post(false)}>
        {posting ? (
          <Loader2 size={14} strokeWidth={1.8} className="animate-spin" />
        ) : (
          <Send size={14} strokeWidth={1.8} />
        )}
        Post reply
      </Button>
      <Button size="sm" variant="secondary" disabled={posting} onClick={() => void post(true)}>
        <CheckCheck size={14} strokeWidth={1.8} />
        Post &amp; resolve
      </Button>
    </>
  );
}
