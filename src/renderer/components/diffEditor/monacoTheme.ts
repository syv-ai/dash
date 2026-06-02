import type { ITheme as XtermTheme } from 'xterm';

export const MONACO_THEME_DARK = 'dash-terminal-dark';
export const MONACO_THEME_LIGHT = 'dash-terminal-light';

/** Define a Monaco theme that mirrors the xterm.js terminal palette. Keeps
 *  the diff editor visually consistent with whichever palette the user
 *  has selected (Default, Dracula, Tokyo Night, …). */
export function defineMonacoThemeFromTerminal(
  monaco: typeof import('monaco-editor'),
  themeName: string,
  isDark: boolean,
  t: XtermTheme,
): void {
  const bg = t.background ?? (isDark ? '#0d0d11' : '#faf8f3');
  const fg = t.foreground ?? (isDark ? '#f1eee5' : '#1c1b18');
  monaco.editor.defineTheme(themeName, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editor.selectionBackground': t.selectionBackground ?? (isDark ? '#2a2f3c' : '#dde2f0'),
      'editor.lineHighlightBackground': isDark ? '#ffffff08' : '#00000008',
      'editorCursor.foreground': t.cursor ?? fg,
      'editorLineNumber.foreground': isDark ? '#5c607080' : '#4a484280',
      'editorLineNumber.activeForeground': fg,
      'editorWidget.background': bg,
      // Gutter and overview ruler share the editor's background so there's no
      // visible strip behind line numbers or the right-side diff minimap.
      'editorGutter.background': bg,
      'editorOverviewRuler.background': bg,
      'editorOverviewRuler.border': '#00000000',
      'editorGutter.commentRangeForeground': bg,
      // Soften the diff-only colors a touch but keep them readable.
      'diffEditor.diagonalFill': '#00000000',
    },
  });
}

export function themeNameFor(isDark: boolean): string {
  return isDark ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
}
