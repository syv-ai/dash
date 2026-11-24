import { toMarkerData } from 'monaco-languageserver-types';
import { monaco } from '../monaco-workers';
import { isServed, onDocumentClosed } from './documentSync';
import { isStale } from './protocol';

const OWNER = 'lsp';

/** Language-server diagnostics as markers on the working models they are
 *  for. A set computed on an older version than the model's is dropped (a
 *  newer one follows the edit); a closed document's markers are cleared. */
export function startDiagnostics(): () => void {
  const offDiagnostics = window.electronAPI.onLspDiagnostics((event) => {
    if (!isServed(event.uri)) return;
    const model = monaco.editor.getModel(monaco.Uri.parse(event.uri));
    if (!model || isStale(event.version, model.getVersionId())) return;
    monaco.editor.setModelMarkers(model, OWNER, event.diagnostics.map(toMarkerData));
  });
  const offClosed = onDocumentClosed((model) => monaco.editor.setModelMarkers(model, OWNER, []));
  return () => {
    offDiagnostics();
    offClosed();
  };
}
