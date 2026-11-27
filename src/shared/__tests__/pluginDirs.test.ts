import { describe, it, expect } from 'vitest';
import { pluginDirsOf } from '../pluginDirs';

describe('pluginDirsOf', () => {
  it('reads each --plugin-dir, spaced or with =', () => {
    expect(pluginDirsOf("--plugin-dir /teamwork --chrome --plugin-dir '/a b'")).toEqual([
      '/teamwork',
      '/a b',
    ]);
    expect(pluginDirsOf('--plugin-dir=/x')).toEqual(['/x']);
  });

  it('gives none for no line, a flag where the value should be, or a refused line', () => {
    expect(pluginDirsOf(null)).toEqual([]);
    expect(pluginDirsOf('--plugin-dir --chrome')).toEqual([]);
    expect(pluginDirsOf('--plugin-dir /x --model opus')).toEqual([]);
  });
});
