/** The app theme as picked in Settings → Appearance: a fixed look, or the OS's. */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The OS's appearance, as Chromium reports it (Electron's `nativeTheme`). */
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** Whether the app draws dark: the choice, or the OS's appearance under System. */
export function resolveIsDark(choice: ThemeChoice, systemDark: boolean): boolean {
  return choice === 'system' ? systemDark : choice === 'dark';
}
