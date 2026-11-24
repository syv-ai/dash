import { Bot, Pencil, Trash2 } from 'lucide-react';
import { canDemote } from '../../../shared/diffComments';
import type { DiffComment } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { CommentInputBar } from '../diffEditor/comments/CommentInputBar';
import { IconButton } from '../ui/IconButton';
import { rowAction } from './rowAction';

/** A draft comment's actions — edit, make it a note (line comments only),
 *  delete — for "Your review"'s rows and the Finish-review sheet's cards.
 *  Their clicks stay their own inside a clickable row. */
export function DraftActions({ comment: c, onEdit }: { comment: DiffComment; onEdit: () => void }) {
  const store = useCommentsStore.getState;
  return (
    <>
      <IconButton size="sm" title="Edit" onClick={rowAction(onEdit)}>
        <Pencil size={14} strokeWidth={1.8} />
      </IconButton>
      {canDemote(c) && (
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
  );
}

/** A draft's text in the composer, in a well: Save keeps it a draft. */
export function DraftEditor({ comment: c, onDone }: { comment: DiffComment; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-well px-2.5 py-2">
      <CommentInputBar
        lineRange={null}
        initialText={c.text}
        submitLabel="Save"
        onSubmit={(text) => {
          useCommentsStore.getState().updateText(c.id, text);
          onDone();
        }}
        onCancel={onDone}
      />
    </div>
  );
}
