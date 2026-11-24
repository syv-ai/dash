/* global process */
// A tiny stdio language server for the LanguageServerManager tests.
// - didOpen/didChange push diagnostics echoing the text (pull with FAKE_PULL=1).
// - Text containing CRASH makes the process exit(3).
// - hover answers {pid, uri, version, text, config}.
// - completion hangs until cancelled.
// - FAKE_HANG_SHUTDOWN=1 ignores shutdown/exit (to prove the SIGKILL fallback).
import rpc from 'vscode-jsonrpc/node';

const conn = rpc.createMessageConnection(
  new rpc.StreamMessageReader(process.stdin),
  new rpc.StreamMessageWriter(process.stdout),
);
const docs = new Map();
const pull = process.env.FAKE_PULL === '1';
let config = null;

const diagnosticsFor = (doc) => [
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message: doc.text,
  },
];

function update(uri, version, text) {
  if (text.includes('CRASH')) process.exit(3);
  const doc = { uri, version, text };
  docs.set(uri, doc);
  if (!pull) {
    void conn.sendNotification('textDocument/publishDiagnostics', {
      uri,
      version,
      diagnostics: diagnosticsFor(doc),
    });
  }
}

conn.onRequest('initialize', () => ({
  capabilities: {
    textDocumentSync: 1,
    hoverProvider: true,
    completionProvider: {},
    ...(pull
      ? { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } }
      : {}),
  },
}));
conn.onNotification('initialized', async () => {
  config = await conn.sendRequest('workspace/configuration', {
    items: [{ section: 'fake.nested' }, { section: 'missing' }],
  });
});
conn.onNotification('textDocument/didOpen', ({ textDocument: d }) =>
  update(d.uri, d.version, d.text),
);
conn.onNotification('textDocument/didChange', ({ textDocument: d, contentChanges }) =>
  update(d.uri, d.version, contentChanges[contentChanges.length - 1].text),
);
conn.onNotification('textDocument/didClose', ({ textDocument: d }) => docs.delete(d.uri));
conn.onRequest('textDocument/diagnostic', ({ textDocument }) => {
  const doc = docs.get(textDocument.uri);
  return { kind: 'full', items: doc ? diagnosticsFor(doc) : [] };
});
conn.onRequest('textDocument/hover', ({ textDocument }) => ({
  pid: process.pid,
  config,
  ...docs.get(textDocument.uri),
}));
conn.onRequest(
  'textDocument/completion',
  (_params, token) =>
    new Promise((_resolve, reject) =>
      token.onCancellationRequested(() => reject(new rpc.ResponseError(-32800, 'cancelled'))),
    ),
);
if (process.env.FAKE_HANG_SHUTDOWN === '1') {
  conn.onRequest('shutdown', () => new Promise(() => {}));
} else {
  conn.onRequest('shutdown', () => null);
  conn.onNotification('exit', () => process.exit(0));
}
conn.listen();
