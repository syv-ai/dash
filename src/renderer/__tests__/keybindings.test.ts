import { describe, it, expect } from 'vitest';
import { parseKeybindings, matchesBinding, DEFAULT_KEYBINDINGS } from '../keybindings';

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

  it('binds the task sidebar toggle to ⌘⌥B', () => {
    expect(DEFAULT_KEYBINDINGS.toggleInspector).toMatchObject({
      mod: true,
      shift: false,
      alt: true,
      key: 'b',
    });
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
    delete older.toggleInspector;
    const result = parseKeybindings(JSON.stringify(older));
    expect(result.toggleSidebar).toEqual(DEFAULT_KEYBINDINGS.toggleSidebar);
    expect(result.findTask).toEqual(DEFAULT_KEYBINDINGS.findTask);
    expect(result.toggleInspector).toEqual(DEFAULT_KEYBINDINGS.toggleInspector);
  });
});

describe('matchesBinding', () => {
  const chord = (over: Partial<KeyboardEvent>) => ({
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    key: '',
    code: '',
    ...over,
  });
  const inspector = DEFAULT_KEYBINDINGS.toggleInspector!;
  const sidebar = DEFAULT_KEYBINDINGS.toggleSidebar!;

  it('matches an ⌥ chord on the physical key when ⌥ changed the character', () => {
    expect(
      matchesBinding(chord({ metaKey: true, altKey: true, key: '∫', code: 'KeyB' }), inspector),
    ).toBe(true);
  });

  it('keeps ⌘B and ⌘⌥B apart', () => {
    const cmdB = chord({ metaKey: true, key: 'b', code: 'KeyB' });
    const cmdAltB = chord({ metaKey: true, altKey: true, key: '∫', code: 'KeyB' });
    expect(matchesBinding(cmdB, sidebar)).toBe(true);
    expect(matchesBinding(cmdB, inspector)).toBe(false);
    expect(matchesBinding(cmdAltB, sidebar)).toBe(false);
  });

  it('does not match another physical key under ⌥', () => {
    expect(
      matchesBinding(chord({ metaKey: true, altKey: true, key: '¬', code: 'KeyL' }), inspector),
    ).toBe(false);
  });
});
