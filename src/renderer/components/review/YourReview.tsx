import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { DiffComment, PrReview } from '../../../shared/types';
import type { ReplyPoster } from '../../stores/prReviewStore';
import { PostReplyButtons } from '../diffEditor/prReview/PostReplyButtons';
import { useTaskReview } from '../diffEditor/prReview/useTaskReview';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DetailSection } from '../ui/DetailList';
import { ListRow } from '../ui/ListRow';
import { DraftActions, DraftEditor } from './DraftActions';
import { FinishReviewSheet } from './FinishReviewSheet';
import { groupByPath, lineLabel } from './outline';
import { rowKeys } from './rowAction';

/**
 * The person's comments and replies for the PR, by file: each can be edited,
 * deleted or turned into a note for the agent. Then the summary and "Finish
 * review…". On the own PR it is "Your replies", shown only when there are any,
 * and each reply can be posted on its own.
 */
export function YourReview({
  review,
  taskId,
  projectId,
  cwd,
  comments,
  noteCount,
  onNavigate,
}: {
  review: PrReview;
  taskId: string;
  projectId: string;
  cwd: string;
  /** The person's comments and replies for this PR (`reviewComments`). */
  comments: DiffComment[];
  /** The task's notes on this PR not yet sent: they stay local. */
  noteCount: number;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const [finishing, setFinishing] = useState(false);
  const { summary } = useTaskReview(taskId, review);
  const own = review.viewerIsAuthor;
  if (own && comments.length === 0) return null;
  const summaryText = summary?.body.trim() ?? '';
  const poster: ReplyPoster | null = own ? { projectId, cwd, taskId, review } : null;

  return (
    <DetailSection title={own ? 'Your replies' : 'Your review'} collapsible>
      {comments.length === 0 && <p className="type-caption px-2.5">No comments yet.</p>}
      {groupByPath(comments).map(([path, list]) => (
        <div key={path} className="grid gap-px">
          <h4 className="type-subheading truncate px-2.5 pt-1" title={path}>
            {path}
          </h4>
          {list.map((c) => (
            <DraftRow key={c.id} comment={c} poster={poster} onNavigate={onNavigate} />
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
        <Button
          size="sm"
          variant={own ? 'secondary' : 'primary'}
          onClick={() => setFinishing(true)}
        >
          Finish review…
        </Button>
      </div>
      {finishing && (
        <FinishReviewSheet
          review={review}
          projectId={projectId}
          cwd={cwd}
          taskId={taskId}
          comments={comments}
          noteCount={noteCount}
          onClose={() => setFinishing(false)}
        />
      )}
    </DetailSection>
  );
}

/** One draft: where it sits and its text; edit, make it a note, delete. A
 *  reply on the own PR can be posted from here. */
function DraftRow({
  comment: c,
  poster,
  onNavigate,
}: {
  comment: DiffComment;
  /** On the own PR: where replies post from. */
  poster: ReplyPoster | null;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) return <DraftEditor comment={c} onDone={() => setEditing(false)} />;
  const open = () => onNavigate(c.viewScope, c.filePath, c.id);
  return (
    <>
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
            <DraftActions comment={c} onEdit={() => setEditing(true)} />
          </>
        }
        onClick={open}
        onKeyDown={rowKeys(open)}
      >
        {c.text}
      </ListRow>
      {poster && c.replyTo && (
        <div className="flex justify-end gap-1 px-2.5 pb-1">
          <PostReplyButtons draft={c} poster={poster} />
        </div>
      )}
    </>
  );
}
