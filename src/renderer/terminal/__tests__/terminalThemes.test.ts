import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { darkTheme, lightTheme } from '../terminalThemes';
import { hslChannelsToHex } from '../../components/diffEditor/monacoTheme';

const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');

/** A role token's channels as one theme block of index.css declares them. */
function token(block: ':root' | '.dark', name: string): string {
  const start = css.indexOf(`${block} {`);
  const body = css.slice(start, css.indexOf('\n  }', start));
  const value = body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1];
  if (value === undefined) throw new Error(`${block} has no --${name}`);
  return value;
}

const opaque = (channels: string) => hslChannelsToHex(channels)?.slice(0, 7);

describe('the default terminal palette', () => {
  // The list, editor and terminal sheets all take the palette's background,
  // so the default palette must be the well role exactly, or the sheets drift
  // off the surface ladder index.css sets.
  it('sits on the well in each theme', () => {
    expect(darkTheme.background).toBe(opaque(token('.dark', 'well')));
    expect(lightTheme.background).toBe(opaque(token(':root', 'well')));
  });

  it('writes in the ink role', () => {
    expect(darkTheme.foreground).toBe(opaque(token('.dark', 'ink')));
  });
});
