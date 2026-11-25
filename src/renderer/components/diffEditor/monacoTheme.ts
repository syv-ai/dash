import type { ITheme as XtermTheme } from '@xterm/xterm';

// Bump the version suffix whenever defineMonacoThemeFromTerminal's output
// changes — Monaco caches themes by name, and the EditorPane's theme effect
// only re-applies when `themeName` actually changes, so renaming forces a
// fresh defineTheme + setTheme on already-open editors.
export const MONACO_THEME_DARK = 'dash-terminal-dark-v10';
export const MONACO_THEME_LIGHT = 'dash-terminal-light-v10';

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
  const bg = t.background ?? (isDark ? '#131415' : '#ffffff');
  const fg = t.foreground ?? (isDark ? '#e7e8e9' : '#2c2f3a');
  // The editor's chrome reads the page's role tokens, so it tracks the theme
  // and its contrast floor (index.css): line numbers in ink-3, the active one
  // in ink, guides on the hairline, the current line on the hover wash, the
  // fold chevrons in the icon ink. The scrollbar is an ink-3 wash that firms
  // up under the pointer (no grey slab), and the peek view sits on the
  // raised surface like the app's other popovers.
  const ink = roleColor('--ink', fg);
  const ink3 = roleColor('--ink-3', isDark ? '#adafb3' : '#6d717b');
  const icon = roleColor('--icon', isDark ? '#bfc1c5' : '#606570');
  const line = roleColor('--line', isDark ? '#ffffff11' : '#28303d17');
  const hover = roleColor('--hover', isDark ? '#ffffff0d' : '#28303d0d');
  const select = roleColor('--select', isDark ? '#ffffff17' : '#28303d17');
  const raised = roleColor('--raised', isDark ? '#1e1f21' : '#ffffff');
  const slider = (alpha: number) => roleColor('--ink-3', '#808080', alpha);

  monaco.editor.defineTheme(themeName, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editor.selectionBackground': t.selectionBackground ?? (isDark ? '#363c4d' : '#c9d2ea'),
      'editor.lineHighlightBackground': hover,
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': t.cursor ?? fg,
      'editorLineNumber.foreground': ink3,
      'editorLineNumber.activeForeground': ink,
      'editorIndentGuide.background1': line,
      'editorIndentGuide.activeBackground1': roleColor('--ink-3', '#80808080', 0.6),
      'editorWhitespace.foreground': roleColor('--ink-3', '#80808066', 0.5),
      'editorRuler.foreground': line,
      'editorGutter.foldingControlForeground': icon,
      'editorWidget.background': bg,
      'editorWidget.border': line,
      // Gutter and overview ruler — fully transparent so the right-side diff
      // strip and the line-number gutter both blend into editor.background.
      'editorGutter.background': '#00000000',
      'editorOverviewRuler.background': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'editorGutter.commentRangeForeground': bg,
      // Scrollbar track inherits editor.background; slider becomes a faint
      // overlay rather than a distinct tinted strip.
      'scrollbar.shadow-sm': '#00000000',
      'scrollbarSlider.background': slider(0.25),
      'scrollbarSlider.hoverBackground': slider(0.4),
      'scrollbarSlider.activeBackground': slider(0.55),
      'minimapSlider.background': slider(0.2),
      'minimapSlider.hoverBackground': slider(0.3),
      'minimapSlider.activeBackground': slider(0.4),
      // Diff-specific decorations: drop the diagonal fill and any tinted
      // borders so the diff editor doesn't sprout its own backdrop.
      'diffEditor.diagonalFill': '#00000000',
      'diffEditor.border': '#00000000',
      // Insert/remove washes, from the loc pair (index.css). Monaco paints
      // both behind the text (view overlays), but on a wholly added line the
      // text wash stacks on the line wash, so each stays faint: together
      // ~16% (was ~28–31%), and code on an added line keeps ~11:1 (was ~9).
      // A changed run inside a line still reads (17% on 7%).
      'diffEditor.insertedLineBackground': roleColor('--loc-add', '#3fb95012', 0.07),
      'diffEditor.removedLineBackground': roleColor('--loc-del', '#f8504912', 0.07),
      'diffEditor.insertedTextBackground': roleColor('--loc-add', '#3fb9501a', 0.1),
      'diffEditor.removedTextBackground': roleColor('--loc-del', '#f850491a', 0.1),
      // The line-number gutter of a changed line: a step firmer than the
      // line wash, so a change shows at a glance without a slab.
      'diffEditorGutter.insertedLineBackground': roleColor('--loc-add', '#3fb95024', 0.14),
      'diffEditorGutter.removedLineBackground': roleColor('--loc-del', '#f8504924', 0.14),
      'diffEditorOverview.insertedForeground': roleColor('--loc-add', '#3fb950b3', 0.7),
      'diffEditorOverview.removedForeground': roleColor('--loc-del', '#f85049b3', 0.7),
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
