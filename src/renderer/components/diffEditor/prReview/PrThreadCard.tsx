import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  ExternalLink,
  Pencil,
  Reply,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import type { DiffComment, PrProvider, PrReviewThread } from '../../../../shared/types';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { useCommentsStore } from '../../../stores/commentsStore';
import { threadLocation } from '../../../utils/prReviewNotices';
import { CommentInputBar } from '../comments/CommentInputBar';

interface Props {
  thread: PrReviewThread;
  provider: PrProvider;
  /** The PR's draft scope, or null when there's no task to own drafts. */
  draftScope: string | null;
  /** Show the file and line above the comments (for threads listed off the code). */
  showLocation?: boolean;
  onSend: (thread: PrReviewThread) => void;
  onSetResolved: (thread: PrReviewThread, resolved: boolean) => void;
}

export const providerName = (p: PrProvider) => (p === 'ado' ? 'Azure DevOps' : 'GitHub');

const EMPTY: DiffComment[] = [];

/** The composer, sized for a card (CommentInputBar fills its container). */
function Composer(props: {
  initialText: string;
  onSubmit: (t: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2.5 flex h-[118px] flex-col gap-2 rounded-lg border border-edge/10 bg-[hsl(var(--surface-1))] px-2.5 py-2">
      <CommentInputBar lineRange={null} placeholder="Reply…" submitLabel="Save draft" {...props} />
    </div>
  );
}

/** One of the task's unsent replies to the thread. */
function ReplyDraft({ draft }: { draft: DiffComment }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <Composer
        initialText={draft.text}
        onSubmit={(text) => {
          useCommentsStore.getState().updateText(draft.id, text);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="min-w-0 rounded-lg border border-dashed border-primary/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-fade-70">
        <span className="font-medium text-primary">Draft reply</span>
        {draft.author === 'agent' && (
          <span className="inline-flex items-center gap-1">
            · <Bot size={12} strokeWidth={1.8} /> agent
          </span>
        )}
        <span className="flex-1" />
        <IconButton title="Edit draft" size="sm" onClick={() => setEditing(true)}>
          <Pencil size={14} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          title="Delete draft"
          size="sm"
          onClick={() => useCommentsStore.getState().remove(draft.id)}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </IconButton>
      </div>
      <div className="whitespace-pre-wrap break-words text-foreground">{draft.text}</div>
    </div>
  );
}

/**
 * One PR review thread: its comments, the task's draft replies, a reply box,
 * Resolve / Reactivate, and "Send to task". A resolved thread starts collapsed
 * to a one-line pill and expands on click.
 */
export function PrThreadCard({
  thread,
  provider,
  draftScope,
  showLocation,
  onSend,
  onSetResolved,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const drafts = useCommentsStore(
    useShallow((s) =>
      draftScope
        ? (s.byFile[thread.path] ?? EMPTY).filter(
            (c) => c.replyTo === thread.id && c.viewScope === draftScope,
          )
        : EMPTY,
    ),
  );
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
          {drafts.length > 0 ? ` · ${drafts.length} draft` : ''}
          {showLocation ? ` · ${threadLocation(thread)}` : ''}
        </span>
      </button>
    );
  }

  const addReply = (text: string) => {
    if (!draftScope) return;
    useCommentsStore.getState().addComment({
      filePath: thread.path,
      startLine: thread.startLine ?? thread.line ?? 1,
      endLine: thread.line ?? 1,
      text,
      viewScope: draftScope,
      replyTo: thread.id,
    });
    setReplying(false);
  };

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
        {drafts.map((d) => (
          <ReplyDraft key={d.id} draft={d} />
        ))}
      </div>
      {replying && (
        <Composer initialText="" onSubmit={addReply} onCancel={() => setReplying(false)} />
      )}
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
        <IconButton
          title={thread.resolved ? 'Reactivate thread' : 'Resolve thread'}
          aria-label={thread.resolved ? 'Reactivate thread' : 'Resolve thread'}
          size="sm"
          onClick={() => onSetResolved(thread, !thread.resolved)}
        >
          {thread.resolved ? (
            <RotateCcw size={14} strokeWidth={1.8} />
          ) : (
            <Check size={14} strokeWidth={1.8} />
          )}
        </IconButton>
        {draftScope && !replying && (
          <Button variant="secondary" size="sm" onClick={() => setReplying(true)}>
            <Reply size={14} strokeWidth={1.8} />
            Reply
          </Button>
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
