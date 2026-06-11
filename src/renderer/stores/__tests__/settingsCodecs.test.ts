import { describe, it, expect } from 'vitest';
import {
  str,
  boolDefaultTrue,
  boolDefaultFalse,
  boolNotFalse,
  strEnum,
  json,
} from '../settingsCodecs';

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

describe('boolDefaultFalse codec', () => {
  const c = boolDefaultFalse();
  it('absent key means false', () => expect(c.decode(null)).toBe(false));
  it("'true' means true", () => expect(c.decode('true')).toBe(true));
  it('any other string means false', () => expect(c.decode('false')).toBe(false));
  it('encodes as legacy string', () => expect(c.encode(true)).toBe('true'));
});

describe('boolNotFalse codec', () => {
  const c = boolNotFalse();
  it('absent key means true', () => expect(c.decode(null)).toBe(true));
  it("'false' means false", () => expect(c.decode('false')).toBe(false));
  it("anything but 'false' means true", () => expect(c.decode('true')).toBe(true));
  it('encodes as legacy string', () => expect(c.encode(false)).toBe('false'));
});

describe('strEnum codec', () => {
  const c = strEnum(['main', 'right'] as const, 'right');
  it('decodes an allowed value', () => expect(c.decode('main')).toBe('main'));
  it('absent falls back to default', () => expect(c.decode(null)).toBe('right'));
  it('invalid value falls back to default', () => expect(c.decode('bogus')).toBe('right'));
  it('encodes the raw string', () => expect(c.encode('main')).toBe('main'));
});

describe('json codec', () => {
  const c = json<{ a: number }>({ a: 0 });
  it('parses stored JSON', () => expect(c.decode('{"a":5}')).toEqual({ a: 5 }));
  it('absent falls back to default', () => expect(c.decode(null)).toEqual({ a: 0 }));
  it('invalid JSON falls back to default', () => expect(c.decode('{bad')).toEqual({ a: 0 }));
  it('encodes as JSON', () => expect(c.encode({ a: 5 })).toBe('{"a":5}'));

  it('honors a validator, falling back when it fails', () => {
    const v = json<{ p: string }>({ p: '' }, (x) => typeof (x as { p?: unknown }).p === 'string');
    expect(v.decode('{"p":"ok"}')).toEqual({ p: 'ok' });
    expect(v.decode('{"p":123}')).toEqual({ p: '' });
  });
});
