import { useCallback } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { commentsPrompt, sendPrompt } from './sendComments';
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
}

/** The editor's send of one comment over `sendComments`: the prompt is
 *  enriched with the live range and code for the current file. */
export function useCommentPrompt({
  activeTaskId,
  filePath,
  modifiedEditor,
  monaco,
  liveComments,
  language,
  scope,
}: Args): (id: string) => void {
  return useCallback(
    (id: string) => {
      if (!activeTaskId) return;
      const model = modifiedEditor?.getModel() ?? null;
      const text = commentsPrompt([id], {
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
      if (text !== null) void sendPrompt(activeTaskId, text, [id]);
    },
    [activeTaskId, filePath, scope, modifiedEditor, monaco, liveComments, language],
  );
}
