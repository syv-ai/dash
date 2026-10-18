import { useState } from 'react';
import { ChevronDown, CircleCheck, ExternalLink, Send } from 'lucide-react';
import type { PrProvider, PrReviewThread } from '../../../../shared/types';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { threadLocation } from '../../../utils/prReviewNotices';

interface Props {
  thread: PrReviewThread;
  provider: PrProvider;
  /** Show the file and line above the comments (for threads listed off the code). */
  showLocation?: boolean;
  onSend: (thread: PrReviewThread) => void;
}

export const providerName = (p: PrProvider) => (p === 'ado' ? 'Azure DevOps' : 'GitHub');

/**
 * One PR review thread: its comments and a "Send to task" action. A resolved
 * thread starts collapsed to a one-line pill and expands on click.
 */
export function PrThreadCard({ thread, provider, showLocation, onSend }: Props) {
  const [expanded, setExpanded] = useState(false);
  const url = thread.comments[0]?.url;
  const n = thread.comments.length;

  if (thread.resolved && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-edge/10 bg-[hsl(var(--surface-2))] px-2.5 py-1 text-[11px] text-muted-fade-70 shadow-sm shadow-shade/10 hover:text-foreground transition-colors"
      >
        <CircleCheck size={14} strokeWidth={1.8} className="shrink-0" />
        <span className="truncate">
          Resolved · @{thread.comments[0]?.author ?? 'ghost'} · {n}{' '}
          {n === 1 ? 'comment' : 'comments'}
          {showLocation ? ` · ${threadLocation(thread)}` : ''}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-edge/10 bg-[hsl(var(--surface-2))] shadow-lg shadow-shade/20 px-3.5 py-3 text-[12px] leading-normal">
      {(showLocation || thread.resolved) && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-fade-70">
          {thread.resolved && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <CircleCheck size={14} strokeWidth={1.8} />
              Resolved
              <ChevronDown size={14} strokeWidth={1.8} />
            </button>
          )}
          {showLocation && <span className="font-mono truncate">{threadLocation(thread)}</span>}
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
            title={`Open on ${providerName(provider)}`}
            size="sm"
            onClick={() => void window.electronAPI.openExternal(url)}
          >
            <ExternalLink size={14} strokeWidth={1.8} />
          </IconButton>
        )}
        {!thread.resolved && (
          <Button variant="secondary" size="sm" onClick={() => onSend(thread)}>
            <Send size={14} strokeWidth={1.8} />
            Send to task
          </Button>
        )}
      </div>
    </div>
  );
}
