import { describe, it, expect } from 'vitest';
import { str, boolDefaultTrue } from '../settingsCodecs';

describe('str codec', () => {
  const c = str('dark');
  it('decodes a stored string', () => expect(c.decode('light')).toBe('light'));
  it('falls back to default when absent', () => expect(c.decode(null)).toBe('dark'));
  it('encodes back to the raw string', () => expect(c.encode('light')).toBe('light'));
});

describe('boolDefaultTrue codec', () => {
  const c = boolDefaultTrue();
  it('absent key means true', () => expect(c.decode(null)).toBe(true));
  it("'false' means false", () => expect(c.decode('false')).toBe(false));
  it("'true' means true", () => expect(c.decode('true')).toBe(true));
  it('encodes booleans as the legacy string', () => {
    expect(c.encode(true)).toBe('true');
    expect(c.encode(false)).toBe('false');
  });
});
