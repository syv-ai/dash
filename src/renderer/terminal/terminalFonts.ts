export interface TerminalFontConfig {
  fontFamily: string | null;
  fontSize: number;
  lineHeight: number;
}

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 13;

export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 2.0;
export const LINE_HEIGHT_DEFAULT = 1.2;
export const LINE_HEIGHT_STEP = 0.1;

export interface CuratedFont {
  name: string;
  family: string; // CSS font-family value (with fallbacks)
}

export const CURATED_FONTS: CuratedFont[] = [
  { name: 'JetBrains Mono', family: "'JetBrains Mono', monospace" },
  { name: 'Fira Code', family: "'Fira Code', monospace" },
  { name: 'SF Mono', family: "'SF Mono', monospace" },
  { name: 'Menlo', family: "'Menlo', monospace" },
  { name: 'Cascadia Code', family: "'Cascadia Code', monospace" },
  { name: 'Source Code Pro', family: "'Source Code Pro', monospace" },
  { name: 'Hack', family: "'Hack', monospace" },
  { name: 'IBM Plex Mono', family: "'IBM Plex Mono', monospace" },
  { name: 'Inconsolata', family: "'Inconsolata', monospace" },
  { name: 'Ubuntu Mono', family: "'Ubuntu Mono', monospace" },
  { name: 'Roboto Mono', family: "'Roboto Mono', monospace" },
  { name: 'Monaco', family: "'Monaco', monospace" },
];

export function defaultFontConfig(): TerminalFontConfig {
  return {
    fontFamily: null,
    fontSize: FONT_SIZE_DEFAULT,
    lineHeight: LINE_HEIGHT_DEFAULT,
  };
}
