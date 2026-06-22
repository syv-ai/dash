import { describe, it, expect } from 'vitest';
import { Utf8Base64 } from '../Utf8Base64';

const codec = new Utf8Base64();

// Each pair below is what a shell actually emits over OSC 52 for the given
// text: the base64 of the real UTF-8 byte sequence, not the Latin-1 reading.
const cases = [
  { name: 'ascii', text: 'hello', base64: 'aGVsbG8=' },
  // の = U+306E = E3 81 AE
  { name: 'hiragana の', text: 'の', base64: '44Gu' },
  // accented Latin: é = U+00E9 = C3 A9
  { name: 'accented Sautéed', text: 'Sautéed', base64: 'U2F1dMOpZWQ=' },
  // box-drawing ─ = U+2500 = E2 94 80
  { name: 'box-drawing ─', text: '─', base64: '4pSA' },
  // emoji outside the BMP: 😀 = F0 9F 98 80
  { name: 'emoji 😀', text: '😀', base64: '8J+YgA==' },
];

describe('Utf8Base64.encodeText', () => {
  for (const { name, text, base64 } of cases) {
    it(`encodes ${name}`, () => {
      expect(codec.encodeText(text)).toBe(base64);
    });
  }
});

describe('Utf8Base64.decodeText', () => {
  for (const { name, text, base64 } of cases) {
    it(`decodes ${name}`, () => {
      expect(codec.decodeText(base64)).toBe(text);
    });
  }

  it('throws on malformed base64', () => {
    expect(() => codec.decodeText('@@@not base64@@@')).toThrow();
  });

  it('throws on valid base64 of non-UTF-8 bytes (e.g. lone 0xFF)', () => {
    // "/w==" is valid base64 for the single byte 0xFF, which is not valid
    // UTF-8. With { fatal: true } the decoder must throw rather than emit a
    // replacement character — keeps mojibake out of the clipboard.
    expect(() => codec.decodeText('/w==')).toThrow();
  });
});

describe('Utf8Base64 round-trip', () => {
  it('preserves mixed multibyte text', () => {
    const samples = ['hello', 'mixed ABC 日本語 123', 'Sautéed', '─━│', '😀🎉'];
    for (const s of samples) {
      expect(codec.decodeText(codec.encodeText(s))).toBe(s);
    }
  });
});
