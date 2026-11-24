import { useMemo } from 'react';
import { Bot, MessageSquare, Send, Trash2, Undo2 } from 'lucide-react';
import { canPromote } from '../../../shared/diffComments';
import type { DiffComment } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { scopeLabel } from '../diffEditor/comments/commentScope';
import { sendComments } from '../diffEditor/comments/sendComments';
import { Button } from '../ui/Button';
import { DetailSection } from '../ui/DetailList';
import { Expandable } from '../ui/Expandable';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { groupByPath, lineLabel, trayNotes } from './outline';
import { rowAction, rowKeys } from './rowAction';

/**
 * The task's notes to the agent from every view, by file: each sent on its
 * own or all at once (typed into the task's Claude prompt, never submitted),
 * then the sent ones, folded, with "Clear sent". A PR's note can become a
 * comment for the author, as its bubble can.
 */
export function NotesTray({
  taskId,
  onNavigate,
}: {
  taskId: string;
  /** Show a note where it was written (its view and file). */
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const byFile = useCommentsStore((s) => s.byFile);
  const ownTask = useCommentsStore((s) => s.taskId === taskId);
  const { unsent, sent } = useMemo(() => trayNotes(byFile), [byFile]);
  if (!ownTask || unsent.length + sent.length === 0) return null;
  const send = (ids: string[]) => void sendComments(taskId, ids);

  return (
    <DetailSection
      title="Notes to agent"
      collapsible
      action={
        unsent.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => send(unsent.map((c) => c.id))}>
            <Send size={14} strokeWidth={1.8} />
            Send all ({unsent.length})
          </Button>
        )
      }
    >
      <NoteGroups notes={unsent} onSend={(id) => send([id])} onNavigate={onNavigate} />
      {sent.length > 0 && (
        <Expandable label={`Sent · ${sent.length}`}>
          <div className="grid gap-1">
            <NoteGroups notes={sent} onNavigate={onNavigate} />
            <div className="flex justify-end px-2.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => useCommentsStore.getState().clearSent()}
              >
                Clear sent
              </Button>
            </div>
          </div>
        </Expandable>
      )}
    </DetailSection>
  );
}

function NoteGroups({
  notes,
  onSend,
  onNavigate,
}: {
  notes: DiffComment[];
  /** Unsent notes: send one. Without it (sent ones), put one back in the next send. */
  onSend?: (id: string) => void;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  return groupByPath(notes).map(([path, list]) => (
    <div key={path} className="grid gap-px">
      <h4 className="type-subheading truncate px-2.5 pt-1" title={path}>
        {path}
      </h4>
      {list.map((c) => (
        <NoteRow key={c.id} note={c} onSend={onSend} onNavigate={onNavigate} />
      ))}
    </div>
  ));
}

function NoteRow({
  note: c,
  onSend,
  onNavigate,
}: {
  note: DiffComment;
  onSend?: (id: string) => void;
  onNavigate: (scope: string, path: string, commentId: string) => void;
}) {
  const store = useCommentsStore.getState;
  const open = () => onNavigate(c.viewScope, c.filePath, c.id);
  return (
    <ListRow
      as="div"
      role="button"
      tabIndex={0}
      size="sm"
      dimmed={c.sent}
      leading={<Bot size={14} strokeWidth={1.8} className="text-icon" />}
      description={`${lineLabel(c)} · ${scopeLabel(c.viewScope)}`}
      trailing={
        <>
          {onSend ? (
            <IconButton size="sm" title="Send to agent" onClick={rowAction(() => onSend(c.id))}>
              <Send size={14} strokeWidth={1.8} />
            </IconButton>
          ) : (
            <IconButton
              size="sm"
              title="Include in the next send"
              onClick={rowAction(() => store().markUnsent(c.id))}
            >
              <Undo2 size={14} strokeWidth={1.8} />
            </IconButton>
          )}
          {canPromote(c) && (
            <IconButton
              size="sm"
              title="Make it a comment for the author"
              onClick={rowAction(() => store().setKind(c.id, 'comment'))}
            >
              <MessageSquare size={14} strokeWidth={1.8} />
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
