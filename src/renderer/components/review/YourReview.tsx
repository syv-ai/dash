import { useState } from 'react';
import { Bot, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import type { DiffComment, PrReview } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { CommentInputBar } from '../diffEditor/comments/CommentInputBar';
import { SubmitReview } from '../diffEditor/prReview/SubmitReview';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DetailSection } from '../ui/DetailList';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { Modal } from '../ui/Modal';
import { groupByPath, lineLabel } from './outline';
import { rowAction, rowKeys } from './rowAction';

/**
 * The person's comments and replies for the PR, by file: each can be edited,
 * deleted or turned into a note for the agent. Then the summary and "Finish
 * review…". On the own PR it is "Your replies", shown only when there are any.
 */
export function YourReview({
  review,
  taskId,
  projectId,
  cwd,
  draftScope,
  comments,
  noteCount,
  onNavigate,
}: {
  review: PrReview;
  taskId: string;
  projectId: string;
  cwd: string;
  draftScope: string;
  /** The person's comments and replies for this PR (`reviewComments`). */
  comments: DiffComment[];
  /** The task's notes on this PR: they stay local. */
  noteCount: number;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const [finishing, setFinishing] = useState(false);
  const { summary } = useTaskReview(taskId, review);
  const own = review.viewerIsAuthor;
  if (own && comments.length === 0) return null;
  const summaryText = summary?.body.trim() ?? '';

  return (
    <DetailSection title={own ? 'Your replies' : 'Your review'} collapsible>
      {comments.length === 0 && <p className="type-caption px-2.5">No comments yet.</p>}
      {groupByPath(comments).map(([path, list]) => (
        <div key={path} className="grid gap-px">
          <h4 className="type-subheading truncate px-2.5 pt-1" title={path}>
            {path}
          </h4>
          {list.map((c) => (
            <DraftRow key={c.id} comment={c} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      {summaryText && (
        <div className="grid gap-0.5 px-2.5 pt-1">
          <h4 className="type-subheading">Summary</h4>
          <p className="type-body line-clamp-3 whitespace-pre-wrap">{summaryText}</p>
        </div>
      )}
      <div className="flex justify-end px-2.5 pt-1">
        <Button size="sm" onClick={() => setFinishing(true)}>
          Finish review…
        </Button>
      </div>
      {finishing && (
        <Modal onClose={() => setFinishing(false)} size="w-full max-w-lg">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <h2 className="type-title min-w-0 flex-1 truncate">
              Finish review of PR #{review.number}
            </h2>
          </div>
          <SubmitReview
            review={review}
            projectId={projectId}
            cwd={cwd}
            taskId={taskId}
            draftCount={comments.length}
            noteCount={noteCount}
            onClearNotes={() => useCommentsStore.getState().clearNotes(draftScope)}
            onSubmitted={() => setFinishing(false)}
          />
        </Modal>
      )}
    </DetailSection>
  );
}

/** One draft: where it sits and its text; edit, make it a note, delete. */
function DraftRow({
  comment: c,
  onNavigate,
}: {
  comment: DiffComment;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-well px-2.5 py-2">
        <CommentInputBar
          lineRange={null}
          initialText={c.text}
          submitLabel="Save"
          onSubmit={(text) => {
            useCommentsStore.getState().updateText(c.id, text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  const store = useCommentsStore.getState;
  const open = () => onNavigate(c.viewScope, c.filePath, c.id);
  return (
    <ListRow
      as="div"
      role="button"
      tabIndex={0}
      size="sm"
      leading={<MessageSquare size={14} strokeWidth={1.8} className="text-icon" />}
      description={c.replyTo ? `Reply · ${lineLabel(c)}` : lineLabel(c)}
      trailing={
        <>
          {c.author === 'agent' && <Badge size="sm">Agent</Badge>}
          <IconButton size="sm" title="Edit" onClick={rowAction(() => setEditing(true))}>
            <Pencil size={14} strokeWidth={1.8} />
          </IconButton>
          {/* A reply is always a comment; a note about a thread is "Ask agent". */}
          {!c.replyTo && (
            <IconButton
              size="sm"
              title="Make it a note to agent"
              onClick={rowAction(() => store().setKind(c.id, 'note'))}
            >
              <Bot size={14} strokeWidth={1.8} />
            </IconButton>
          )}
          <IconButton
            size="sm"
            variant="destructive"
            title="Delete"
            onClick={rowAction(() => store().remove(c.id))}
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </IconButton>
        </>
      }
      onClick={open}
      onKeyDown={rowKeys(open)}
    >
      {c.text}
    </ListRow>
  );
}
