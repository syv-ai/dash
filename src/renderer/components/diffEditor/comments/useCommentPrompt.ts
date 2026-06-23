import { useCallback, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useCommentsStore } from '../../../stores/commentsStore';
import { buildCommentPrompt, type PromptComment } from './commentPrompt';
import type { LiveComment } from './types';

interface Args {
  activeTaskId: string | null;
  filePath: string;
  modifiedEditor: monacoEditor.ICodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  liveComments: LiveComment[];
  language: string;
  /** Scope of the open view — used for code enrichment (only current-scope,
   *  current-file comments can be enriched from the live model). */
  scope: string;
  onClose: () => void;
}

export interface CommentPrompt {
  /** Non-null while the edit-before-send modal is open. */
  editTarget: { ids: string[]; text: string } | null;
  /** Send every unsent comment across all views, then close the modal. */
  sendAllUnsent: () => void;
  /** Send the unsent comments of one view (scope). Keeps the menu open. */
  sendScope: (scope: string) => void;
  /** Send one comment; keeps the modal open (the user is triaging). */
  sendOne: (id: string) => void;
  /** Open the edit-before-send modal prefilled with every unsent comment. */
  openEditAndSend: () => void;
  /** Ship the (possibly edited) text and close. */
  confirmEditAndSend: (editedText: string) => void;
  cancelEditAndSend: () => void;
}

/** Prompt assembly + send-to-TUI + edit-and-send. Builds `path:line:` excerpts
 *  from the store (all files) enriched with live ranges + code for the current
 *  file, ships them to the task's terminal session, and marks them sent. */
export function useCommentPrompt({
  activeTaskId,
  filePath,
  modifiedEditor,
  monaco,
  liveComments,
  language,
  scope,
  onClose,
}: Args): CommentPrompt {
  // All comments across every view — the menu manages and sends across scopes.
  const byFile = useCommentsStore((s) => s.byFile);
  const [editTarget, setEditTarget] = useState<{ ids: string[]; text: string } | null>(null);

  const build = useCallback(
    (ids: ReadonlyArray<string>): string | null => {
      const model = modifiedEditor?.getModel() ?? null;
      const promptByFile: Record<string, PromptComment[]> = {};
      for (const [path, list] of Object.entries(byFile)) {
        promptByFile[path] = list.map((c) => ({
          id: c.id,
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          text: c.text,
          viewScope: c.viewScope,
        }));
      }
      return buildCommentPrompt({
        ids,
        byFile: promptByFile,
        currentFilePath: filePath,
        currentScope: scope,
        currentFile:
          model && monaco
            ? {
                language,
                codeForId: (c) => {
                  const live = liveComments.find((lc) => lc.id === c.id);
                  const start = live?.startLine ?? c.startLine;
                  const end = live?.endLine ?? c.endLine;
                  return model.getValueInRange(
                    new monaco.Range(start, 1, end, model.getLineMaxColumn(end)),
                  );
                },
              }
            : undefined,
      });
    },
    [byFile, filePath, scope, modifiedEditor, monaco, liveComments, language],
  );

  // Unsent ids, optionally limited to one view (scope).
  const collectUnsentIds = useCallback(
    (onlyScope?: string): string[] => {
      const ids: string[] = [];
      for (const list of Object.values(byFile))
        for (const c of list)
          if (!c.sent && (onlyScope === undefined || c.viewScope === onlyScope)) ids.push(c.id);
      return ids;
    },
    [byFile],
  );

  const writeToTui = useCallback(
    (text: string, idsToMarkSent: ReadonlyArray<string>) => {
      if (!activeTaskId) return;
      const taskId = activeTaskId;
      void import('../../../terminal/SessionRegistry').then(({ sessionRegistry }) => {
        sessionRegistry.get(taskId)?.writeInput(text);
      });
      useCommentsStore.getState().markSent(idsToMarkSent);
    },
    [activeTaskId],
  );

  const sendAllUnsent = useCallback(() => {
    if (!activeTaskId) return;
    const ids = collectUnsentIds();
    const text = build(ids);
    if (text === null) return;
    writeToTui(text, ids);
    onClose();
  }, [activeTaskId, collectUnsentIds, build, writeToTui, onClose]);

  const sendScope = useCallback(
    (scopeToSend: string) => {
      if (!activeTaskId) return;
      const ids = collectUnsentIds(scopeToSend);
      const text = build(ids);
      if (text === null) return;
      writeToTui(text, ids);
    },
    [activeTaskId, collectUnsentIds, build, writeToTui],
  );

  const sendOne = useCallback(
    (id: string) => {
      if (!activeTaskId) return;
      const text = build([id]);
      if (text === null) return;
      writeToTui(text, [id]);
    },
    [activeTaskId, build, writeToTui],
  );

  const openEditAndSend = useCallback(() => {
    if (!activeTaskId) return;
    const ids = collectUnsentIds();
    const text = build(ids);
    if (text === null) return;
    setEditTarget({ ids, text });
  }, [activeTaskId, collectUnsentIds, build]);

  const confirmEditAndSend = useCallback(
    (editedText: string) => {
      if (!editTarget) return;
      writeToTui(editedText, editTarget.ids);
      setEditTarget(null);
      onClose();
    },
    [editTarget, writeToTui, onClose],
  );

  const cancelEditAndSend = useCallback(() => setEditTarget(null), []);

  return {
    editTarget,
    sendAllUnsent,
    sendScope,
    sendOne,
    openEditAndSend,
    confirmEditAndSend,
    cancelEditAndSend,
  };
}
