import { describe, it, expect } from 'vitest';
import {
  str,
  boolDefaultTrue,
  boolDefaultFalse,
  boolNotFalse,
  strEnum,
  json,
  stringSet,
  nullableInt,
  strOrUndefined,
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

describe('stringSet codec', () => {
  const c = stringSet();
  it('decodes a JSON array into a Set', () => {
    const s = c.decode('["a","b"]');
    expect(s instanceof Set).toBe(true);
    expect([...s]).toEqual(['a', 'b']);
  });
  it('absent yields an empty Set', () => expect([...c.decode(null)]).toEqual([]));
  it('invalid JSON yields an empty Set', () => expect([...c.decode('{bad')]).toEqual([]));
  it('drops non-string members', () => expect([...c.decode('["a",1,null]')]).toEqual(['a']));
  it('encodes a Set as a JSON array', () =>
    expect(c.encode(new Set(['a', 'b']))).toBe('["a","b"]'));
});

describe('nullableInt codec', () => {
  const c = nullableInt(3);
  it('absent decodes to null', () => expect(c.decode(null)).toBeNull());
  it("'null' sentinel decodes to null", () => expect(c.decode('null')).toBeNull());
  it('numeric string decodes to a number', () => expect(c.decode('5')).toBe(5));
  it('invalid decodes to the fallback', () => expect(c.decode('abc')).toBe(3));
  it('encodes a number', () => expect(c.encode(5)).toBe('5'));
  it('encodes null as the sentinel', () => expect(c.encode(null)).toBe('null'));
});

describe('strOrUndefined codec', () => {
  const c = strOrUndefined();
  it('absent decodes to undefined', () => expect(c.decode(null)).toBeUndefined());
  it('empty string is preserved', () => expect(c.decode('')).toBe(''));
  it('custom string is preserved', () => expect(c.decode('x')).toBe('x'));
  it('encodes a string as itself', () => expect(c.encode('x')).toBe('x'));
});
