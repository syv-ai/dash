import { useCallback, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LineRange, LiveComment } from './types';

interface Args {
  modifiedEditor: monacoEditor.ICodeEditor | null;
  setPendingRange: (r: LineRange | null) => void;
  binding: {
    addComment: (range: LineRange, text: string) => LiveComment | null;
    updateText: (id: string, text: string) => void;
  };
}

export interface CommentDraft {
  /** Prefilled text for the draft popover (empty for a fresh comment). */
  pendingText: string;
  /** Id of the comment being edited, or null for a fresh comment. */
  editingId: string | null;
  /** Submit handler for the draft bubble; routes to add or edit. */
  submit: (text: string, pendingRange: LineRange | null) => void;
  cancel: () => void;
  /** Begin editing an existing comment (dbl-click) — seeds text + range. */
  beginEdit: (comment: LiveComment) => void;
}

/** Owns the in-progress comment (fresh-create vs edit) state. Does NOT own
 *  pendingRange — that lives in useGutterSelection — but drives it so the
 *  draft popover opens/closes in sync. */
export function useCommentDraft({ modifiedEditor, setPendingRange, binding }: Args): CommentDraft {
  const [pendingText, setPendingText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const submit = useCallback(
    (text: string, pendingRange: LineRange | null) => {
      if (editingId) {
        binding.updateText(editingId, text);
      } else if (pendingRange) {
        binding.addComment(pendingRange, text);
      }
      setEditingId(null);
      setPendingText('');
      setPendingRange(null);
    },
    [editingId, binding, setPendingRange],
  );

  const cancel = useCallback(() => {
    setEditingId(null);
    setPendingText('');
    setPendingRange(null);
  }, [setPendingRange]);

  const beginEdit = useCallback(
    (comment: LiveComment) => {
      const model = modifiedEditor?.getModel();
      const range = model?.getDecorationRange(comment.decorationId);
      if (!range) return;
      setEditingId(comment.id);
      setPendingText(comment.text);
      setPendingRange({ start: range.startLineNumber, end: range.endLineNumber });
    },
    [modifiedEditor, setPendingRange],
  );

  return { pendingText, editingId, submit, cancel, beginEdit };
}
