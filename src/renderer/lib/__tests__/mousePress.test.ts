import { describe, expect, it } from 'vitest';
import { pressKind } from '../mousePress';

describe('pressKind', () => {
  it('reads the primary button as primary, the secondary as context', () => {
    expect(pressKind({ button: 0, ctrlKey: false }, true)).toBe('primary');
    expect(pressKind({ button: 2, ctrlKey: false }, true)).toBe('context');
    expect(pressKind({ button: 2, ctrlKey: false }, false)).toBe('context');
  });

  it('reads a Control-click as context on a Mac only', () => {
    expect(pressKind({ button: 0, ctrlKey: true }, true)).toBe('context');
    expect(pressKind({ button: 0, ctrlKey: true }, false)).toBe('primary');
  });

  it('reads the middle and extra buttons as neither', () => {
    expect(pressKind({ button: 1, ctrlKey: false }, false)).toBe('other');
    expect(pressKind({ button: 3, ctrlKey: false }, true)).toBe('other');
  });
});
