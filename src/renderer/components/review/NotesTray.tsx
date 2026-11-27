import { useMemo } from 'react';
import { Bot, MessageSquare, Send, Trash2, Undo2 } from 'lucide-react';
import { canPromote } from '../../../shared/diffComments';
import type { DiffComment } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { scopeLabel } from '../diffEditor/comments/commentScope';
import { sendComments } from '../diffEditor/comments/sendComments';
import { Button } from '../ui/Button';
import { DetailSection } from '../ui/DetailList';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { groupByPath, lineLabel, trayNotes } from './outline';
import { rowAction, rowKeys } from './rowAction';
import { useSectionOpen } from './useSectionOpen';

/**
 * The task's notes to the agent from every view, by file: To send, each sent
 * on its own or all at once (typed into the task's Claude prompt, never
 * submitted), then Sent, folded, with "Clear sent". A PR's note can become a
 * comment for the author, as its bubble can. The Threads tab's Notes and the
 * editor's "n to send" both show it.
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
  const toSend = useSectionOpen('notes.unsent', true);
  const sentOpen = useSectionOpen('notes.sent', false);
  const { unsent, sent } = useMemo(() => trayNotes(byFile), [byFile]);
  if (!ownTask || unsent.length + sent.length === 0) {
    return <p className="type-caption px-2.5 pt-2">No notes yet.</p>;
  }
  const send = (ids: string[]) => void sendComments(taskId, ids);

  return (
    <div>
      {unsent.length > 0 && (
        <DetailSection
          title="To send"
          summary={String(unsent.length)}
          collapsible
          {...toSend}
          action={
            <Button size="sm" variant="secondary" onClick={() => send(unsent.map((c) => c.id))}>
              <Send size={14} strokeWidth={1.8} />
              Send all
            </Button>
          }
        >
          <NoteGroups notes={unsent} onSend={(id) => send([id])} onNavigate={onNavigate} />
        </DetailSection>
      )}
      {sent.length > 0 && (
        <DetailSection title="Sent" summary={String(sent.length)} collapsible {...sentOpen}>
          <NoteGroups notes={sent} onNavigate={onNavigate} />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => useCommentsStore.getState().clearSent()}
            >
              Clear sent
            </Button>
          </div>
        </DetailSection>
      )}
    </div>
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
      leading={<Bot size={14} strokeWidth={1.8} />}
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
