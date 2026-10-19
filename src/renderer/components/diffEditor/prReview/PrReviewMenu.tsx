import { ExternalLink, GitPullRequestArrow, Send } from 'lucide-react';
import type { PrReview, PrReviewComment, PrReviewThread } from '../../../../shared/types';
import { formatRelativeTime } from '../../../../shared/relativeTime';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import { threadLocation, unresolvedThreads } from '../../../utils/prReviewNotices';
import { useCommentsStore } from '../../../stores/commentsStore';
import { PrThreadCard, providerName } from './PrThreadCard';
import { SubmitReview } from './SubmitReview';

interface Props {
  review: PrReview;
  draftScope: string | null;
  /** Where submits go; null without a task (the panel is then read-only). */
  submitCtx: { projectId: string; cwd: string; taskId: string } | null;
  onSetResolved: (thread: PrReviewThread, resolved: boolean) => void;
  onSendAll: () => void;
  onSend: (thread: PrReviewThread) => void;
  onSelectFile: (path: string) => void;
}

/** True when a thread can be drawn on the PR side of its file. */
export function isInlineThread(t: PrReviewThread): boolean {
  return t.line !== null && t.side === 'RIGHT';
}

function ConversationEntry({
  c,
  provider,
}: {
  c: PrReviewComment;
  provider: PrReview['provider'];
}) {
  const ago = formatRelativeTime(Date.parse(c.createdAt) / 1000, Date.now() / 1000);
  return (
    <div className="rounded-md px-2 py-1.5 text-[12px]">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-fade-70">
        <span className="font-medium text-fg-fade-80">@{c.author}</span>
        {ago && <span>{ago} ago</span>}
        <span className="flex-1" />
        {c.url && (
          <IconButton
            title={`Open on ${providerName(provider)}`}
            size="sm"
            onClick={() => void window.electronAPI.openExternal(c.url)}
          >
            <ExternalLink size={14} strokeWidth={1.8} />
          </IconButton>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words text-foreground">{c.body.trim()}</div>
    </div>
  );
}

/**
 * The PR view's corner menu: the PR's general conversation, its unresolved
 * threads with "Send all to task", and the threads with no line to sit on
 * (outdated, on a removed line, or on the whole file), which the code view
 * can't place.
 */
export function PrReviewMenu({
  review,
  draftScope,
  submitCtx,
  onSetResolved,
  onSendAll,
  onSend,
  onSelectFile,
}: Props) {
  const open = unresolvedThreads(review);
  const count = open.length;
  const offCode = review.threads.filter((t) => !isInlineThread(t));
  const draftCount = useCommentsStore((s) => {
    if (!draftScope) return 0;
    let n = 0;
    for (const list of Object.values(s.byFile))
      for (const c of list) if (c.viewScope === draftScope) n++;
    return n;
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="bg-[hsl(var(--surface-2))] shadow-lg shadow-shade/20"
        >
          <GitPullRequestArrow size={14} strokeWidth={1.8} />
          {draftCount > 0
            ? `Review · ${draftCount} ${draftCount === 1 ? 'draft' : 'drafts'}`
            : count === 0
              ? 'No unresolved threads'
              : `${count} unresolved ${count === 1 ? 'thread' : 'threads'}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-h-[70vh] overflow-y-auto p-2">
        <div className="flex items-center gap-2 px-1.5 pb-2">
          <span className="flex-1 text-[12px] text-fg-fade-80 truncate">
            PR #{review.number}
            {review.title ? `: ${review.title}` : ''}
          </span>
          <Button size="sm" disabled={count === 0} onClick={onSendAll}>
            <Send size={14} strokeWidth={1.8} />
            Send all to task
          </Button>
        </div>
        {review.partial && (
          <div className="px-1.5 pb-2 text-[11px] text-muted-fade-70">
            This PR has more threads than Dash loads; see the rest on{' '}
            {providerName(review.provider)}.
          </div>
        )}
        {review.conversation.length > 0 && (
          <div className="mb-2 flex flex-col">
            <div className="px-1.5 pb-1 text-[11px] text-muted-fade-70">
              Conversation ({review.conversation.length})
            </div>
            {review.conversation.map((c) => (
              <ConversationEntry key={c.id} c={c} provider={review.provider} />
            ))}
          </div>
        )}
        {open.filter(isInlineThread).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelectFile(t.path)}
            className="w-full flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
          >
            <span className="font-mono text-[11px] text-muted-fade-70 truncate max-w-full">
              {threadLocation(t)}
            </span>
            <span className="text-[12px] text-foreground truncate max-w-full">
              @{t.comments[0]?.author}: {t.comments[0]?.body.trim().split('\n')[0]}
            </span>
          </button>
        ))}
        {offCode.length > 0 && (
          <div className="mt-2 flex flex-col items-start gap-2">
            <div className="px-1.5 text-[11px] text-muted-fade-70">Not on the current code</div>
            {offCode.map((t) => (
              <div key={t.id} className="w-full">
                <PrThreadCard
                  thread={t}
                  provider={review.provider}
                  draftScope={draftScope}
                  showLocation
                  onSend={onSend}
                  onSetResolved={onSetResolved}
                />
              </div>
            ))}
          </div>
        )}
        {submitCtx && <SubmitReview review={review} draftCount={draftCount} {...submitCtx} />}
      </PopoverContent>
    </Popover>
  );
}
