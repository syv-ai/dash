import type { CancellationToken, editor as monacoEditor } from 'monaco-editor';
import type { LspRequestMethod } from '../../shared/lsp';
import { syncedDocument, type SyncedDocument } from './documentSync';
import { isStale } from './protocol';

let seq = 0;

/**
 * Ask the model's language server. The document is flushed first, Monaco's
 * cancellation is relayed as `$/cancelRequest`, and an answer for an older
 * version of the model is dropped.
 *
 * Resolves to the server's result (which may itself be null) and the document
 * it answered for, or undefined when there is no answer: no server,
 * cancelled, failed, or stale.
 */
export async function lspRequest<R>(
  model: monacoEditor.ITextModel,
  method: LspRequestMethod,
  params: (doc: SyncedDocument) => object,
  token: CancellationToken,
): Promise<{ result: R; doc: SyncedDocument } | undefined> {
  const doc = await syncedDocument(model);
  if (!doc || token.isCancellationRequested) return undefined;
  const version = model.getVersionId();
  const requestId = `r${++seq}`;
  const sub = token.onCancellationRequested(() => window.electronAPI.lspCancel({ requestId }));
  try {
    const resp = await window.electronAPI.lspRequest({
      uri: doc.uri,
      method,
      params: params(doc) as Record<string, unknown>,
      requestId,
    });
    if (!resp.success) {
      if (resp.code !== 'CANCELLED') console.debug(`[lsp] ${method}:`, resp.error);
      return undefined;
    }
    if (
      token.isCancellationRequested ||
      model.isDisposed() ||
      isStale(version, model.getVersionId())
    )
      return undefined;
    return { result: resp.data as R, doc };
  } finally {
    sub.dispose();
  }
}
