import type { ITheme as XtermTheme } from '@xterm/xterm';

// Bump the version suffix whenever defineMonacoThemeFromTerminal's output
// changes — Monaco caches themes by name, and the EditorPane's theme effect
// only re-applies when `themeName` actually changes, so renaming forces a
// fresh defineTheme + setTheme on already-open editors.
export const MONACO_THEME_DARK = 'dash-terminal-dark-v7';
export const MONACO_THEME_LIGHT = 'dash-terminal-light-v7';

/** HSL channels ("220 4% 47%", optionally "/ 0.06") as #rrggbbaa. */
export function hslChannelsToHex(channels: string, alpha = 1): string | null {
  const m = channels.trim().match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+))?$/);
  if (!m) return null;
  const h = (((Number(m[1]) % 360) + 360) % 360) / 360;
  const sat = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = (m[4] === undefined ? 1 : Number(m[4])) * alpha;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const hex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(channel(h + 1 / 3))}${hex(channel(h))}${hex(channel(h - 1 / 3))}${hex(a)}`;
}

/** A role token (`--ink-3`, `--select`, …) as Monaco wants a colour, from the
 *  theme now on the page; `fallback` when it can't be read. */
export function roleColor(token: string, fallback: string, alpha = 1): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token);
  return hslChannelsToHex(value, alpha) ?? fallback;
}

/** Define a Monaco theme that mirrors the xterm.js terminal palette. Keeps
 *  the diff editor visually consistent with whichever palette the user
 *  has selected (Default, Dracula, Tokyo Night, …). */
export function defineMonacoThemeFromTerminal(
  monaco: typeof import('monaco-editor'),
  themeName: string,
  isDark: boolean,
  t: XtermTheme,
): void {
  const bg = t.background ?? (isDark ? '#101011' : '#ffffff');
  const fg = t.foreground ?? (isDark ? '#e7e8e9' : '#2c2f3a');
  // The page's role tokens: the scrollbar is a faint ink-3 wash that firms
  // up under the pointer (no grey slab), and the peek view sits on the
  // raised surface like the app's other popovers.
  const ink = roleColor('--ink', fg);
  const ink3 = roleColor('--ink-3', isDark ? '#74777c' : '#82858d');
  const line = roleColor('--line', isDark ? '#ffffff0f' : '#28303d14');
  const select = roleColor('--select', isDark ? '#ffffff0f' : '#28303d11');
  const raised = roleColor('--raised', isDark ? '#171819' : '#ffffff');
  const sliderBg = roleColor('--ink-3', '#80808026', 0.15);
  const sliderHover = roleColor('--ink-3', '#80808040', 0.3);
  const sliderActive = roleColor('--ink-3', '#80808059', 0.45);

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
      // Peek (definitions, references): the raised surface, hairline edges,
      // the select tint, in place of Monaco's blue.
      'peekView.border': line,
      'peekViewTitle.background': raised,
      'peekViewTitleLabel.foreground': ink,
      'peekViewTitleDescription.foreground': ink3,
      'peekViewResult.background': raised,
      'peekViewResult.fileForeground': ink,
      'peekViewResult.lineForeground': ink3,
      'peekViewResult.selectionBackground': select,
      'peekViewResult.selectionForeground': ink,
      'peekViewResult.matchHighlightBackground': roleColor('--state-needs', '#d0902033', 0.25),
      'peekViewEditor.background': bg,
      'peekViewEditorGutter.background': bg,
      'peekViewEditorStickyScroll.background': bg,
      'peekViewEditorStickyScrollGutter.background': bg,
      'peekViewEditor.matchHighlightBackground': roleColor('--state-needs', '#d0902033', 0.25),
      'peekViewEditor.matchHighlightBorder': '#00000000',
    },
  });
}

export function themeNameFor(isDark: boolean): string {
  return isDark ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
}
