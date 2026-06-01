// Register Monaco's base editor worker only. We deliberately skip the
// language-service workers (ts/css/html/json): this view is for reading,
// commenting, and minor edits — not IntelliSense — and ts.worker alone
// embeds the full TypeScript compiler. Syntax highlighting uses core
// Monarch grammars which run on the main thread.
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

const w = self as unknown as {
  MonacoEnvironment?: { getWorker: () => Worker };
  __dashMonacoWorkerInstalled?: boolean;
};

if (!w.__dashMonacoWorkerInstalled) {
  w.MonacoEnvironment = {
    getWorker() {
      return new editorWorker();
    },
  };
  w.__dashMonacoWorkerInstalled = true;
}
