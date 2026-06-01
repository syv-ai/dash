export const DEFAULT_FONT_MONO_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

export interface TerminalFont {
  id: string;
  label: string;
  family: string | null;
}

export const TERMINAL_FONTS: TerminalFont[] = [
  { id: 'system', label: 'System default', family: null },
  { id: 'menlo', label: 'Menlo', family: 'Menlo' },
  { id: 'monaco', label: 'Monaco', family: 'Monaco' },
  { id: 'sf-mono', label: 'SF Mono', family: 'SF Mono' },
  { id: 'courier-new', label: 'Courier New', family: 'Courier New' },
  { id: 'dejavu-sans-mono', label: 'DejaVu Sans Mono', family: 'DejaVu Sans Mono' },
  { id: 'liberation-mono', label: 'Liberation Mono', family: 'Liberation Mono' },
];

function quoteIfNeeded(family: string): string {
  return family.includes(' ') ? `'${family}'` : family;
}

export function resolveTerminalFontValue(id: string): string {
  const entry = TERMINAL_FONTS.find((f) => f.id === id);
  if (!entry || entry.family === null) return DEFAULT_FONT_MONO_STACK;
  return `${quoteIfNeeded(entry.family)}, ${DEFAULT_FONT_MONO_STACK}`;
}

// Read the current --font-mono value off :root. Falls back to the default stack
// if the var is empty (e.g. during very early boot before CSS applies).
export function getFontMono(): string {
  if (typeof document === 'undefined') return DEFAULT_FONT_MONO_STACK;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return value || DEFAULT_FONT_MONO_STACK;
}
