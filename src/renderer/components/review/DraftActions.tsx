import type * as React from 'react';
import { Bot, Pencil, Trash2 } from 'lucide-react';
import { canDemote } from '../../../shared/diffComments';
import type { DiffComment } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { CommentInputBar } from '../diffEditor/comments/CommentInputBar';
import { IconButton } from '../ui/IconButton';
import { rowAction } from './rowAction';

/** A draft comment's actions — edit, make it a note (line comments only),
 *  delete — for the Threads tab's draft rows and the Finish-review sheet's cards.
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
export function DraftEditor({
  comment: c,
  mentions,
  onDone,
}: {
  comment: DiffComment;
  /** Who `@` completes from. */
  mentions?: readonly string[];
  onDone: () => void;
}) {
  return (
    <Composer>
      <CommentInputBar
        lineRange={null}
        initialText={c.text}
        mentions={mentions}
        submitLabel="Save"
        cancelButton
        onSubmit={(text) => {
          useCommentsStore.getState().updateText(c.id, text);
          onDone();
        }}
        onCancel={onDone}
      />
    </Composer>
  );
}

/** The composer's well, for a draft written or edited in a list or card. */
export function Composer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-well px-3 py-2.5">
      {children}
    </div>
  );
}
