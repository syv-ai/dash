import { describe, it, expect } from 'vitest';
import { parseKeybindings, DEFAULT_KEYBINDINGS } from '../keybindings';

describe('parseKeybindings', () => {
  it('returns the defaults when raw is null', () => {
    expect(parseKeybindings(null)).toEqual(DEFAULT_KEYBINDINGS);
  });

  it('merges a stored override onto the default binding', () => {
    const stored = JSON.stringify({ newTask: { ...DEFAULT_KEYBINDINGS.newTask, key: 'm' } });
    const result = parseKeybindings(stored);
    expect(result.newTask!.key).toBe('m');
    expect(result.saveFile).toEqual(DEFAULT_KEYBINDINGS.saveFile); // untouched default still present
  });

  it('falls back to defaults on invalid JSON', () => {
    expect(parseKeybindings('{bad')).toEqual(DEFAULT_KEYBINDINGS);
  });
});
