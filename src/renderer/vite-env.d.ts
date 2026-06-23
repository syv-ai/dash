/// <reference types="vite/client" />

declare module '*.wav' {
  const src: string;
  export default src;
}

declare module '*.mp3' {
  const src: string;
  export default src;
}

// Monaco's editor.api is the core entry: DiffEditor + Editor + the API surface,
// without the four language-service contribution modules (ts/css/html/json)
// that would each pull in their own worker via Vite's `?worker` suffix.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor';
}

declare module 'monaco-editor/esm/vs/editor/browser/widget/diffEditor/features/overviewRulerFeature' {
  export class OverviewRulerFeature {
    static ONE_OVERVIEW_WIDTH: number;
    static ENTIRE_DIFF_OVERVIEW_WIDTH: number;
  }
}

// Monaco's deep language-contribution modules ship no type declarations.
// TypeScript 6's stricter side-effect-import check (TS2882) needs them declared.
declare module 'monaco-editor/esm/vs/basic-languages/*';
