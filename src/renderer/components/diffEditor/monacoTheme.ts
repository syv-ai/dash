import type { ITheme as XtermTheme } from '@xterm/xterm';

// Bump the version suffix whenever defineMonacoThemeFromTerminal's output
// changes — Monaco caches themes by name, and the EditorPane's theme effect
// only re-applies when `themeName` actually changes, so renaming forces a
// fresh defineTheme + setTheme on already-open editors.
export const MONACO_THEME_DARK = 'dash-terminal-dark-v6';
export const MONACO_THEME_LIGHT = 'dash-terminal-light-v6';

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
  // Subtle scrollbar slider that stays readable on the editor bg without
  // introducing a separate background color for the scrollbar track.
  const sliderBg = isDark ? '#ffffff14' : '#0000001a';
  const sliderHover = isDark ? '#ffffff22' : '#00000028';
  const sliderActive = isDark ? '#ffffff33' : '#00000033';

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
      // Gutter and overview ruler — fully transparent so the right-side diff
      // strip and the line-number gutter both blend into editor.background.
      'editorGutter.background': '#00000000',
      'editorOverviewRuler.background': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'editorGutter.commentRangeForeground': bg,
      // Scrollbar track inherits editor.background; slider becomes a faint
      // overlay rather than a distinct tinted strip.
      'scrollbar.shadow-sm': '#00000000',
      'scrollbarSlider.background': sliderBg,
      'scrollbarSlider.hoverBackground': sliderHover,
      'scrollbarSlider.activeBackground': sliderActive,
      // Diff-specific decorations: drop the diagonal fill and any tinted
      // borders so the diff editor doesn't sprout its own backdrop.
      'diffEditor.diagonalFill': '#00000000',
      'diffEditor.border': '#00000000',
      // Insert/remove backgrounds. Monaco's defaults are ~20% alpha
      // (#9ccc2c33 / #ff000033) which reads as a loud highlighter; we keep the
      // changed *text* a touch stronger (~18–20%) than the full *line* wash
      // (~12–14%) so syntax colors stay legible while the region reads clearly.
      'diffEditor.insertedTextBackground': isDark ? '#3fb9502e' : '#2da14433',
      'diffEditor.removedTextBackground': isDark ? '#f850492e' : '#cf222e33',
      'diffEditor.insertedLineBackground': isDark ? '#3fb95020' : '#2da14424',
      'diffEditor.removedLineBackground': isDark ? '#f8504920' : '#cf222e24',
      'diffEditorOverview.insertedForeground': isDark ? '#3fb95080' : '#2da14480',
      'diffEditorOverview.removedForeground': isDark ? '#f8504980' : '#cf222e80',
    },
  });
}

export function themeNameFor(isDark: boolean): string {
  return isDark ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
}
