import { describe, it, expect } from 'vitest';
import {
  TERMINAL_FONTS,
  DEFAULT_FONT_MONO_STACK,
  resolveTerminalFontValue,
} from '../terminalFonts';

describe('TERMINAL_FONTS', () => {
  it('includes the system default as the first entry', () => {
    expect(TERMINAL_FONTS[0]).toEqual({
      id: 'system',
      label: 'System default',
      family: null,
    });
  });

  it('exposes every curated entry with a unique id', () => {
    const ids = TERMINAL_FONTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers Menlo, Monaco, SF Mono, Courier New, DejaVu, Liberation', () => {
    const ids = TERMINAL_FONTS.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'system',
        'menlo',
        'monaco',
        'sf-mono',
        'courier-new',
        'dejavu-sans-mono',
        'liberation-mono',
      ]),
    );
  });
});

describe('resolveTerminalFontValue', () => {
  it('returns the bare default stack for the system entry', () => {
    expect(resolveTerminalFontValue('system')).toBe(DEFAULT_FONT_MONO_STACK);
  });

  it('prepends a quoted family to the default stack for SF Mono', () => {
    expect(resolveTerminalFontValue('sf-mono')).toBe(`'SF Mono', ${DEFAULT_FONT_MONO_STACK}`);
  });

  it('prepends an unquoted family when the name has no spaces', () => {
    expect(resolveTerminalFontValue('menlo')).toBe(`Menlo, ${DEFAULT_FONT_MONO_STACK}`);
  });

  it('falls back to the system default for an unknown id', () => {
    expect(resolveTerminalFontValue('not-a-real-font')).toBe(DEFAULT_FONT_MONO_STACK);
  });
});
