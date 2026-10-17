import { GitPullRequestArrow, Send } from 'lucide-react';
import type { PrReview, PrReviewThread } from '../../../../shared/types';
import { Button } from '../../ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import { threadLocation } from '../../../utils/prReviewNotices';
import { PrThreadCard } from './PrThreadCard';

interface Props {
  review: PrReview;
  onSendAll: () => void;
  onSend: (thread: PrReviewThread) => void;
  onSelectFile: (path: string) => void;
}

/** True when a thread can be drawn on the PR side of its file. */
export function isInlineThread(t: PrReviewThread): boolean {
  return t.line !== null && t.side === 'RIGHT';
}

/**
 * The PR view's corner menu: every unresolved thread, with "Send all to task".
 * Threads with no line to sit on (outdated, or on a removed line) are shown in
 * full here, since the code view can't place them.
 */
export function PrReviewMenu({ review, onSendAll, onSend, onSelectFile }: Props) {
  const count = review.threads.length;
  const offCode = review.threads.filter((t) => !isInlineThread(t));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="bg-[hsl(var(--surface-2))] shadow-lg shadow-shade/20"
        >
          <GitPullRequestArrow size={14} strokeWidth={1.8} />
          {count === 0
            ? 'No unresolved threads'
            : `${count} unresolved ${count === 1 ? 'thread' : 'threads'}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-h-[70vh] overflow-y-auto p-2">
        <div className="flex items-center gap-2 px-1.5 pb-2">
          <span className="flex-1 text-[12px] text-fg-fade-80">PR #{review.number}</span>
          <Button size="sm" disabled={count === 0} onClick={onSendAll}>
            <Send size={14} strokeWidth={1.8} />
            Send all to task
          </Button>
        </div>
        {review.threads.filter(isInlineThread).map((t) => (
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
          <div className="mt-2 flex flex-col gap-2">
            <div className="px-1.5 text-[11px] text-muted-fade-70">Not on the current code</div>
            {offCode.map((t) => (
              <PrThreadCard key={t.id} thread={t} showLocation onSend={onSend} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
