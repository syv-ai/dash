import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  ChevronUp,
  ExternalLink,
  GitPullRequestArrow,
  Send,
  Trash2,
} from 'lucide-react';
import type {
  DiffComment,
  PrReview,
  PrReviewComment,
  PrReviewThread,
} from '../../../../shared/types';
import { formatRelativeTime } from '../../../../shared/relativeTime';
import { isPrComment, isReplyDraft } from '../../../../shared/diffComments';
import { IconButton } from '../../ui/IconButton';
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import { threadLocation, unresolvedThreads } from '../../../utils/prReviewNotices';
import { useCommentsStore } from '../../../stores/commentsStore';
import {
  ActionButton,
  FileGroups,
  MenuSection,
  SectionAction,
  type RowDecorations,
  type RowHandlers,
} from '../comments/CommentList';
import { PrThreadCard, providerName } from './PrThreadCard';
import { SubmitReview } from './SubmitReview';
import { Markdown } from '../../ui/Markdown';

interface Props {
  review: PrReview;
  draftScope: string | null;
  /** The task is reviewing the PR (replies wait for it). */
  inReview: boolean;
  /** Where submits go; null without a task (the panel is then read-only). */
  submitCtx: { projectId: string; cwd: string; taskId: string } | null;
  currentFilePath: string;
  /** Live range for a comment in the open file (else null). */
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (scope: string, filePath: string, commentId: string) => void;
  onSendOne: (commentId: string) => void;
  onSendMany: (commentIds: ReadonlyArray<string>) => void;
  onSetResolved: (thread: PrReviewThread, resolved: boolean) => void;
  onSendAll: () => void;
  onSend: (thread: PrReviewThread) => void;
  onSelectFile: (path: string) => void;
}

/** True when a thread can be drawn on the PR side of its file. */
export function isInlineThread(t: PrReviewThread): boolean {
  return t.line !== null && t.side === 'RIGHT';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[3px] rounded-[3px] bg-foreground/10 px-[5px] py-[1px] font-sans text-[9px] font-medium uppercase tracking-[0.04em] text-muted-fade-75">
      {children}
    </span>
  );
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
    <div className="min-w-0 rounded-md px-2 py-1.5 text-[12px]">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-fade-70">
        <span className="min-w-0 truncate font-medium text-fg-fade-80">@{c.author}</span>
        {ago && <span className="shrink-0">{ago} ago</span>}
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
      <Markdown text={c.body.trim()} className="text-foreground" />
    </div>
  );
}

/**
 * The PR view's corner widget: your comments (drafts Submit posts) and notes
 * (local, for the agent) per file, the PR's unresolved threads, the threads
 * with no line to sit on, its conversation, and Submit. Nothing in it scrolls
 * sideways: long text wraps.
 */
export function PrReviewMenu({
  review,
  draftScope,
  inReview,
  submitCtx,
  currentFilePath,
  getLiveRangeForCurrent,
  onNavigate,
  onSendOne,
  onSendMany,
  onSetResolved,
  onSendAll,
  onSend,
  onSelectFile,
}: Props) {
  const [open, setOpen] = useState(false);
  const byFile = useCommentsStore((s) => s.byFile);
  const { comments, notes } = useMemo(() => {
    const comments: DiffComment[] = [];
    const notes: DiffComment[] = [];
    if (draftScope) {
      for (const list of Object.values(byFile))
        for (const c of list)
          if (c.viewScope === draftScope) (isPrComment(c) ? comments : notes).push(c);
    }
    return { comments, notes };
  }, [byFile, draftScope]);

  const unresolved = unresolvedThreads(review);
  const inlineOpen = unresolved.filter(isInlineThread);
  const offCode = review.threads.filter((t) => !isInlineThread(t));
  const unsent = (list: DiffComment[]) => list.filter((c) => !c.sent).map((c) => c.id);
  const unsentComments = unsent(comments);
  const unsentNotes = unsent(notes);

  const rowHandlers: RowHandlers = {
    getLiveRangeForCurrent,
    onNavigate,
    onRemove: (_path, id) => useCommentsStore.getState().remove(id),
    onSendOne,
    onUnsend: (id) => useCommentsStore.getState().markUnsent(id),
    closeMenu: () => setOpen(false),
  };
  const groups = (list: DiffComment[], decorations: RowDecorations) => (
    <FileGroups
      comments={list}
      scope={draftScope!}
      currentFilePath={currentFilePath}
      {...rowHandlers}
      {...decorations}
    />
  );

  const label = [
    comments.length > 0 && plural(comments.length, 'comment'),
    notes.length > 0 && plural(notes.length, 'note'),
    unresolved.length > 0 && plural(unresolved.length, 'thread'),
  ].filter(Boolean);
  const busy = comments.length > 0 || unsentNotes.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`group/trigger flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-full text-[11px] font-medium border backdrop-blur-md transition-all duration-200 ease-out ${
            busy
              ? 'border-primary/30 bg-primary/9 text-primary hover:bg-primary/[0.14] hover:border-primary/45'
              : 'border-border/40 bg-foreground/2.5 text-muted-fade-80 hover:bg-foreground/6 hover:border-border/55 hover:text-fg-fade-90'
          }`}
        >
          <GitPullRequestArrow size={12} strokeWidth={2} />
          <span className="tabular-nums tracking-tight">
            {label.length > 0 ? label.join(' · ') : `PR #${review.number}`}
          </span>
          <ChevronUp
            size={11}
            strokeWidth={2.2}
            className="opacity-60 transition-transform duration-200 ease-out group-data-[state=open]/trigger:rotate-180"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="glass-popover w-[460px] max-w-[calc(100vw-32px)] max-h-[70vh] flex flex-col p-0 overflow-hidden"
      >
        <div className="flex items-baseline gap-2 px-4 pt-3 pb-2.5 border-b border-foreground/6 shrink-0">
          <h3 className="min-w-0 flex-1 text-[12px] font-semibold tracking-tight text-fg-fade-90 wrap-break-word">
            PR #{review.number}
            {review.title ? `: ${review.title}` : ''}
          </h3>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {review.partial && (
            <div className="px-4 py-2 text-[11px] text-muted-fade-70">
              This PR has more threads than Dash loads; see the rest on{' '}
              {providerName(review.provider)}.
            </div>
          )}
          {comments.length > 0 && (
            <MenuSection
              title="Your comments"
              dotClass="bg-primary/80"
              count={`${comments.length} to submit`}
              actions={
                unsentComments.length > 0 && (
                  <SectionAction
                    label="Send"
                    title={`Send ${plural(unsentComments.length, 'comment')} to the agent; they're still submitted`}
                    icon={<Send size={10} strokeWidth={2.2} />}
                    tone="primary"
                    onClick={() => onSendMany(unsentComments)}
                  />
                )
              }
            >
              {groups(comments, {
                renderTag: (c) => (
                  <>
                    {isReplyDraft(c) && <Tag>Reply</Tag>}
                    {c.author === 'agent' && (
                      <Tag>
                        <Bot size={10} strokeWidth={1.8} />
                        Agent
                      </Tag>
                    )}
                    {c.sent && <Tag>Sent</Tag>}
                  </>
                ),
              })}
            </MenuSection>
          )}
          {notes.length > 0 && (
            <MenuSection
              title="Notes"
              dotClass="bg-muted-foreground/50"
              count={`${notes.length} local`}
              actions={
                <>
                  {unsentNotes.length > 0 && (
                    <SectionAction
                      label="Send"
                      title={`Send ${plural(unsentNotes.length, 'note')} to the agent`}
                      icon={<Send size={10} strokeWidth={2.2} />}
                      tone="primary"
                      onClick={() => onSendMany(unsentNotes)}
                    />
                  )}
                  <SectionAction
                    label="Clear"
                    title={`Delete ${plural(notes.length, 'note')}`}
                    icon={<Trash2 size={10} strokeWidth={2.2} />}
                    tone="destructive"
                    onClick={() => useCommentsStore.getState().clearNotes(draftScope!)}
                  />
                </>
              }
            >
              {groups(notes, {
                renderTag: (c) =>
                  c.author === 'agent' && (
                    <Tag>
                      <Bot size={10} strokeWidth={1.8} />
                      Agent
                    </Tag>
                  ),
                renderActions: (c) => (
                  <ActionButton
                    label="Promote to a PR comment"
                    onClick={() => useCommentsStore.getState().setKind(c.id, 'comment')}
                    tone="primary"
                  >
                    <ArrowUpRight size={11} strokeWidth={2} />
                  </ActionButton>
                ),
              })}
            </MenuSection>
          )}
          {inlineOpen.length > 0 && (
            <MenuSection
              title="Unresolved threads"
              dotClass="bg-primary/50"
              count={String(inlineOpen.length)}
              actions={
                <SectionAction
                  label="Send all"
                  title="Send every unresolved thread to the task"
                  icon={<Send size={10} strokeWidth={2.2} />}
                  tone="primary"
                  onClick={() => {
                    setOpen(false);
                    onSendAll();
                  }}
                />
              }
            >
              {inlineOpen.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelectFile(t.path);
                  }}
                  className="w-full min-w-0 flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-foreground/4 transition-colors"
                >
                  <span className="max-w-full font-mono text-[10.5px] text-muted-fade-70 break-all">
                    {threadLocation(t)}
                  </span>
                  <span className="max-w-full text-[12px] leading-snug text-foreground line-clamp-2 wrap-break-word">
                    @{t.comments[0]?.author}: {t.comments[0]?.body.trim()}
                  </span>
                </button>
              ))}
            </MenuSection>
          )}
          {offCode.length > 0 && (
            <MenuSection
              title="Not on the current code"
              dotClass="bg-muted-foreground/40"
              count={String(offCode.length)}
            >
              <div className="flex min-w-0 flex-col gap-2">
                {offCode.map((t) => (
                  <PrThreadCard
                    key={t.id}
                    thread={t}
                    provider={review.provider}
                    draftScope={draftScope}
                    inReview={inReview}
                    showLocation
                    onSend={onSend}
                    onSetResolved={onSetResolved}
                  />
                ))}
              </div>
            </MenuSection>
          )}
          {review.conversation.length > 0 && (
            <MenuSection
              title="Conversation"
              dotClass="bg-muted-foreground/40"
              count={String(review.conversation.length)}
              defaultOpen={false}
            >
              {review.conversation.map((c) => (
                <ConversationEntry key={c.id} c={c} provider={review.provider} />
              ))}
            </MenuSection>
          )}
          {comments.length === 0 &&
            notes.length === 0 &&
            unresolved.length === 0 &&
            offCode.length === 0 && (
              <div className="px-4 py-6 text-center text-[11px] italic text-muted-fade-55">
                No comments, notes or unresolved threads.
              </div>
            )}
        </div>

        {submitCtx && (
          <SubmitReview
            review={review}
            draftCount={comments.length}
            noteCount={notes.length}
            onClearNotes={() => useCommentsStore.getState().clearNotes(draftScope!)}
            {...submitCtx}
          />
        )}
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}
