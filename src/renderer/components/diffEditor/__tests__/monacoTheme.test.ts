import { describe, expect, it } from 'vitest';
import { hslChannelsToHex } from '../monacoTheme';

describe('hslChannelsToHex', () => {
  it('converts opaque channels', () => {
    expect(hslChannelsToHex('0 0% 100%')).toBe('#ffffffff');
    expect(hslChannelsToHex('0 100% 50%')).toBe('#ff0000ff');
    expect(hslChannelsToHex(' 120 100% 25% ')).toBe('#008000ff');
  });

  it("keeps a token's own alpha and multiplies the caller's in", () => {
    expect(hslChannelsToHex('0 0% 100% / 0.06')).toBe('#ffffff0f');
    expect(hslChannelsToHex('0 0% 0%', 0.5)).toBe('#00000080');
  });

  it('turns down what is not HSL channels', () => {
    expect(hslChannelsToHex('')).toBeNull();
    expect(hslChannelsToHex('var(--x)')).toBeNull();
  });
});
