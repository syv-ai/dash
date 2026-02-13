import type { ITheme } from 'xterm';
import type { ThemeId } from '../shared/types';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  isDark: boolean;
  icon: string; // lucide-react icon name
}

export const THEMES: ThemeMeta[] = [
  { id: 'light', label: 'Light', isDark: false, icon: 'Sun' },
  { id: 'dark', label: 'Dark', isDark: true, icon: 'Moon' },
  { id: 'solarized-dark', label: 'Solarized', isDark: true, icon: 'Palette' },
  { id: 'nord', label: 'Nord', isDark: true, icon: 'Snowflake' },
];

export function isThemeDark(id: ThemeId): boolean {
  return THEMES.find((t) => t.id === id)?.isDark ?? true;
}

const lightTheme: ITheme = {
  background: '#fafafa',
  foreground: '#383a42',
  cursor: '#383a42',
  cursorAccent: '#fafafa',
  selectionBackground: '#bfceff',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#696c77',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#ffffff',
};

const darkTheme: ITheme = {
  background: '#1f1f1f',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1f1f1f',
  selectionBackground: '#3a3a5a',
  black: '#000000',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d4d4d4',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const solarizedDarkTheme: ITheme = {
  background: '#002b36',
  foreground: '#839496',
  cursor: '#839496',
  cursorAccent: '#002b36',
  selectionBackground: '#073642',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#586e75',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3',
};

const nordTheme: ITheme = {
  background: '#2e3440',
  foreground: '#d8dee9',
  cursor: '#d8dee9',
  cursorAccent: '#2e3440',
  selectionBackground: '#434c5e',
  black: '#3b4252',
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#81a1c1',
  magenta: '#b48ead',
  cyan: '#88c0d0',
  white: '#e5e9f0',
  brightBlack: '#4c566a',
  brightRed: '#bf616a',
  brightGreen: '#a3be8c',
  brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1',
  brightMagenta: '#b48ead',
  brightCyan: '#8fbcbb',
  brightWhite: '#eceff4',
};

export const TERMINAL_THEMES: Record<ThemeId, ITheme> = {
  light: lightTheme,
  dark: darkTheme,
  'solarized-dark': solarizedDarkTheme,
  nord: nordTheme,
};
