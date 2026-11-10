import type { ITheme } from '@xterm/xterm';

/** Font metrics every Dash xterm uses (task panes, drawer tabs, the Setup log). */
export const TERMINAL_BASE_OPTIONS = { fontSize: 13, lineHeight: 1.2 } as const;

/**
 * Drawer terminals sit on the floating right-pane glass: a transparent xterm
 * background lets the frost show through. Pair with `allowTransparency: true`.
 */
export function glassTheme(theme: ITheme): ITheme {
  return { ...theme, background: 'rgba(0,0,0,0)' };
}
