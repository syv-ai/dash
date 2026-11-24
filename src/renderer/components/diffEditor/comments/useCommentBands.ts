import { useEffect, useRef } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LiveComment, Shade } from './types';
import { computeRowDecorations } from './rowShades';

interface Args {
  modifiedEditor: monacoEditor.ICodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  liveComments: LiveComment[];
  shadeById: ReadonlyMap<string, Shade>;
  disabled: boolean;
  hoveredCommentId: string | null;
}

/** Owns the per-row shade-band decoration collection for the open file. Each
 *  row gets one of three classNames depending on which comments claim it;
 *  coalesced runs of same-signature rows become single decoration ranges.
 *  Where comments sit in the whole file is the review rail's (`ReviewRail`). */
export function useCommentBands({
  modifiedEditor,
  monaco,
  liveComments,
  shadeById,
  disabled,
  hoveredCommentId,
}: Args): void {
  const commentDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!modifiedEditor || !monaco) return;
    const model = modifiedEditor.getModel();
    if (!model) return;
    if (!commentDecorations.current) {
      commentDecorations.current = modifiedEditor.createDecorationsCollection();
    }
    if (disabled) {
      commentDecorations.current.clear();
      return;
    }
    // liveComments already carry live ranges (useFileComments re-projects on
    // edits) and shadeById is the shared single shade assignment.
    if (liveComments.length === 0) {
      commentDecorations.current.clear();
      return;
    }
    const rows = computeRowDecorations(liveComments, shadeById);
    // Build the highlighted-line set from the hovered comment, if any.
    // A coalesced run is entirely-in or entirely-out of this set because
    // each run covers lines that share the exact same signature, and the
    // hovered comment is a single signature contributor.
    const highlightedLines = new Set<number>();
    if (hoveredCommentId) {
      const hovered = liveComments.find((c) => c.id === hoveredCommentId);
      if (hovered) {
        for (let l = hovered.startLine; l <= hovered.endLine; l++) {
          highlightedLines.add(l);
        }
      }
    }
    const decos: monacoEditor.IModelDeltaDecoration[] = rows.map((r) => {
      const hi = highlightedLines.has(r.startLine);
      const cls = `monaco-comment-line-shade-${r.signature}${hi ? '-hi' : ''}`;
      return {
        range: new monaco.Range(r.startLine, 1, r.endLine, 1),
        options: {
          isWholeLine: true,
          className: cls,
          lineNumberClassName: `monaco-comment-ln-shade-${r.signature}`,
        },
      };
    });
    // The kind's rule beside the line numbers: dashed for a note to the
    // agent, solid for a PR comment (D10).
    for (const c of liveComments) {
      decos.push({
        range: new monaco.Range(c.startLine, 1, c.endLine, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: `monaco-comment-rule-${c.kind}`,
        },
      });
    }
    commentDecorations.current.set(decos);
  }, [liveComments, shadeById, disabled, modifiedEditor, monaco, hoveredCommentId]);
}
