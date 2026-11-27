import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EASE, MOTION_MS } from '../motion';

const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

describe('motion tokens', () => {
  it.each(Object.entries(MOTION_MS))('--motion-%s matches index.css', (name, ms) => {
    expect(token(`motion-${name}`)).toBe(`${ms}ms`);
  });

  it.each(Object.entries(EASE))('--ease-%s matches index.css', (name, curve) => {
    expect(token(`ease-${name}`)).toBe(curve);
  });

  it('keeps quick < tooltip < calm < slow', () => {
    expect(MOTION_MS.quick).toBeLessThan(MOTION_MS.tooltip);
    expect(MOTION_MS.tooltip).toBeLessThan(MOTION_MS.calm);
    expect(MOTION_MS.calm).toBeLessThan(MOTION_MS.slow);
  });
});
