// Register Monaco's base editor worker only, and point @monaco-editor/react's
// loader at the locally-bundled ESM build so it never reaches for the CDN
// (which would break in offline packaged Electron apps).
//
// We import from `editor.api` (the core entry) rather than the package main
// (`monaco-editor`), because the package main also pulls in the four
// language-service contribution modules (ts/css/html/json). Each of those
// imports its own `.worker?worker`, which Vite then bundles — ts.worker
// alone is ~7 MB because it embeds the TypeScript compiler. We deliberately
// avoid the language services here: this view is for reading, commenting,
// and minor edits, not IntelliSense.
//
// Syntax highlighting (Monarch grammars) runs on the main thread and is
// pulled in per-language via the `basic-languages/*/*.contribution` imports
// below — only the languages we actually map in `detectLanguage`.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { OverviewRulerFeature } from 'monaco-editor/esm/vs/editor/browser/widget/diffEditor/features/overviewRulerFeature';
import { loader } from '@monaco-editor/react';

// Slim the diff editor's overview ruler. Default is 15px per side (30px total).
// The class's static constants are read on every layout pass and in the
// constructor that sets the `.diffOverview` container width, so overwriting
// here — before any diff editor mounts — narrows both the strip and the
// content gutter the diff widget reserves for it.
const SLIM_ONE_OVERVIEW_WIDTH = 6;
OverviewRulerFeature.ONE_OVERVIEW_WIDTH = SLIM_ONE_OVERVIEW_WIDTH;
OverviewRulerFeature.ENTIRE_DIFF_OVERVIEW_WIDTH = SLIM_ONE_OVERVIEW_WIDTH * 2;

// Curated basic-language grammars (mirror src/main/ipc/fileIpc.ts#detectLanguage).
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import 'monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution';
import 'monaco-editor/esm/vs/basic-languages/swift/swift.contribution';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/scss/scss.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution';
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution';
import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution';

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
  loader.config({ monaco: monaco as unknown as Parameters<typeof loader.config>[0]['monaco'] });
  w.__dashMonacoWorkerInstalled = true;
}
