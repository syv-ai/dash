import { ExternalLink, Send } from 'lucide-react';
import type { PrReviewThread } from '../../../../shared/types';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { threadLocation } from '../../../utils/prReviewNotices';

interface Props {
  thread: PrReviewThread;
  /** Show the file and line above the comments (for threads listed off the code). */
  showLocation?: boolean;
  onSend: (thread: PrReviewThread) => void;
}

/** One unresolved PR review thread, read-only: its comments and a "Send to task" action. */
export function PrThreadCard({ thread, showLocation, onSend }: Props) {
  const url = thread.comments[0]?.url;
  return (
    <div className="rounded-xl border border-edge/10 bg-[hsl(var(--surface-2))] shadow-lg shadow-shade/20 px-3.5 py-3 text-[12px] leading-normal">
      {showLocation && (
        <div className="mb-2 font-mono text-[11px] text-muted-fade-70 truncate">
          {threadLocation(thread)}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {thread.comments.map((c) => (
          <div key={c.id} className="min-w-0">
            <div className="text-[11px] font-medium text-fg-fade-80">@{c.author}</div>
            <div className="whitespace-pre-wrap break-words text-foreground">{c.body.trim()}</div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-1">
        {url && (
          <IconButton
            title="Open on GitHub"
            size="sm"
            onClick={() => void window.electronAPI.openExternal(url)}
          >
            <ExternalLink size={14} strokeWidth={1.8} />
          </IconButton>
        )}
        <Button variant="secondary" size="sm" onClick={() => onSend(thread)}>
          <Send size={14} strokeWidth={1.8} />
          Send to task
        </Button>
      </div>
    </div>
  );
}
