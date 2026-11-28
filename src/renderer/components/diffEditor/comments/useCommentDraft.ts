import { useCallback, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { DiffComment, LineRange, LiveComment } from './types';

interface Args {
  modifiedEditor: monacoEditor.ICodeEditor | null;
  setPendingRange: (r: LineRange | null) => void;
  binding: {
    addComment: (range: LineRange, text: string) => LiveComment | null;
    updateText: (id: string, text: string, from?: DiffComment) => void;
  };
}

export interface CommentDraft {
  /** Prefilled text for the draft popover (empty for a fresh comment). */
  pendingText: string;
  /** Id of the comment being edited, or null for a fresh comment. */
  editingId: string | null;
  /** Submit handler for the draft bubble; routes to add or edit. Returns the
   *  new comment's id when it added one. */
  submit: (text: string, pendingRange: LineRange | null) => string | null;
  cancel: () => void;
  /** Begin editing an existing comment (dbl-click) — seeds text + range. */
  beginEdit: (comment: LiveComment) => void;
}

/** The comment as stored, without the editor's decoration. */
const storedOf = ({ decorationId: _decorationId, ...stored }: LiveComment): DiffComment => stored;

/** Owns the in-progress comment (fresh-create vs edit) state. Does NOT own
 *  pendingRange — that lives in useGutterSelection — but drives it so the
 *  draft popover opens/closes in sync. */
export function useCommentDraft({ modifiedEditor, setPendingRange, binding }: Args): CommentDraft {
  const [pendingText, setPendingText] = useState('');
  // The comment as it was when editing began, so a save can tell whether the
  // agent changed it meanwhile.
  const [editing, setEditing] = useState<DiffComment | null>(null);
  const editingId = editing?.id ?? null;

  const submit = useCallback(
    (text: string, pendingRange: LineRange | null) => {
      let added: string | null = null;
      if (editing) {
        binding.updateText(editing.id, text, editing);
      } else if (pendingRange) {
        added = binding.addComment(pendingRange, text)?.id ?? null;
      }
      setEditing(null);
      setPendingText('');
      setPendingRange(null);
      return added;
    },
    [editing, binding, setPendingRange],
  );

  const cancel = useCallback(() => {
    setEditing(null);
    setPendingText('');
    setPendingRange(null);
  }, [setPendingRange]);

  const beginEdit = useCallback(
    (comment: LiveComment) => {
      const model = modifiedEditor?.getModel();
      const range = model?.getDecorationRange(comment.decorationId);
      if (!range) return;
      setEditing(storedOf(comment));
      setPendingText(comment.text);
      setPendingRange({ start: range.startLineNumber, end: range.endLineNumber });
    },
    [modifiedEditor, setPendingRange],
  );

  return { pendingText, editingId, submit, cancel, beginEdit };
}
