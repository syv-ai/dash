import type { IDisposable, IPosition, IRange } from 'monaco-editor';
import { monaco } from '../monaco-workers';
import { openFileAt } from '../components/diffEditor/openFileAt';

/** A position as the empty range at it. */
function toRange(at: IRange | IPosition): IRange {
  return 'startLineNumber' in at
    ? at
    : {
        startLineNumber: at.lineNumber,
        startColumn: at.column,
        endLineNumber: at.lineNumber,
        endColumn: at.column,
      };
}

/**
 * Go-to-definition (⌘-click, F12) and peek's "open" into another file open
 * that file in a tab of the active task's editor and reveal the target there.
 * The editor's own file is left to Monaco, which moves within it.
 */
export function registerOpener(): IDisposable {
  return monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      if (resource.scheme !== 'file') return false;
      if (source.getModel()?.uri.toString() === resource.toString()) return false;
      const range = selectionOrPosition ? toRange(selectionOrPosition) : undefined;
      return openFileAt(resource.fsPath, range);
    },
  });
}
