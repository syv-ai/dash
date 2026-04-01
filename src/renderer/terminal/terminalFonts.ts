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

/**
 * Known monospace font families to probe for on the system.
 * We test each against the generic 'monospace' fallback using canvas measurement.
 * Excludes names already in CURATED_FONTS to avoid duplicates.
 */
const SYSTEM_FONT_CANDIDATES: string[] = [
  // macOS
  'Andale Mono',
  'Courier New',
  'Monaco',
  'PT Mono',
  'SF Mono',
  'Menlo',
  // Nerd Font variants (common with terminal users)
  'MesloLGS Nerd Font Mono',
  'MesloLGM Nerd Font Mono',
  'MesloLGL Nerd Font Mono',
  'MesloLGSDZ Nerd Font Mono',
  'MesloLGMDZ Nerd Font Mono',
  'MesloLGLDZ Nerd Font Mono',
  'MesloLGS Nerd Font',
  'MesloLGM Nerd Font',
  'MesloLGL Nerd Font',
  'FiraCode Nerd Font Mono',
  'FiraCode Nerd Font',
  'Hack Nerd Font Mono',
  'Hack Nerd Font',
  'JetBrainsMono Nerd Font Mono',
  'JetBrainsMono Nerd Font',
  'Symbols Nerd Font Mono',
  'Symbols Nerd Font',
  // Popular coding fonts
  'Maple Mono',
  'Maple Mono NF',
  'Maple Mono Normal NF',
  'Cascadia Mono',
  'Cascadia Code',
  'Consolas',
  'Courier',
  'DejaVu Sans Mono',
  'Droid Sans Mono',
  'Fantasque Sans Mono',
  'Iosevka',
  'Iosevka Term',
  'Liberation Mono',
  'Noto Sans Mono',
  'Operator Mono',
  'Input Mono',
  'Victor Mono',
  'Anonymous Pro',
  'Bitstream Vera Sans Mono',
  'Oxygen Mono',
  'Overpass Mono',
  'Space Mono',
  'Azeret Mono',
  'Red Hat Mono',
  'Geist Mono',
  'Monaspace Neon',
  'Monaspace Argon',
  'Monaspace Xenon',
  'Monaspace Radon',
  'Monaspace Krypton',
  'Berkeley Mono',
  'Comic Mono',
  'Commit Mono',
  'Intel One Mono',
  // Linux
  'FreeMono',
  'Nimbus Mono L',
  'Tlwg Mono',
  'Noto Mono',
];

/**
 * Detect which fonts from SYSTEM_FONT_CANDIDATES are actually installed,
 * using canvas text measurement. Returns font names not already in CURATED_FONTS.
 */
export function detectInstalledFonts(): string[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const testString = 'mmmmmmmmmmlli1|WW@@';
  const size = '72px';
  const fallback = 'monospace';

  // Measure with just the fallback
  ctx.font = `${size} ${fallback}`;
  const fallbackWidth = ctx.measureText(testString).width;

  const curatedNames = new Set(CURATED_FONTS.map((f) => f.name.toLowerCase()));

  const installed: string[] = [];
  for (const font of SYSTEM_FONT_CANDIDATES) {
    if (curatedNames.has(font.toLowerCase())) continue;

    ctx.font = `${size} '${font}', ${fallback}`;
    const width = ctx.measureText(testString).width;
    if (width !== fallbackWidth) {
      installed.push(font);
    }
  }

  return installed.sort((a, b) => a.localeCompare(b));
}
