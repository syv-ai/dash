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

describe('DEFAULT_KEYBINDINGS', () => {
  it('binds the sidebar toggle to ⌘B and the task finder to ⌘K', () => {
    expect(DEFAULT_KEYBINDINGS.toggleSidebar).toMatchObject({ mod: true, shift: false, key: 'b' });
    expect(DEFAULT_KEYBINDINGS.findTask).toMatchObject({ mod: true, shift: false, key: 'k' });
  });

  it('gives every default a distinct chord', () => {
    const chords = Object.values(DEFAULT_KEYBINDINGS).map(
      (b) => `${b.mod}|${b.shift}|${b.alt}|${b.key.toLowerCase()}`,
    );
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('adds new defaults to a map stored before they existed', () => {
    const older: Partial<typeof DEFAULT_KEYBINDINGS> = { ...DEFAULT_KEYBINDINGS };
    delete older.toggleSidebar;
    delete older.findTask;
    const result = parseKeybindings(JSON.stringify(older));
    expect(result.toggleSidebar).toEqual(DEFAULT_KEYBINDINGS.toggleSidebar);
    expect(result.findTask).toEqual(DEFAULT_KEYBINDINGS.findTask);
  });
});
