import { describe, it, expect } from 'vitest';
import { createMemoryStorage, fanOutStorage } from '../fanOutStorage';

const NAME = 'settings';

describe('fanOutStorage', () => {
  it('setItem fans each field out to its own key in legacy encoding', () => {
    const mem = createMemoryStorage();
    const s = fanOutStorage(mem);
    s.setItem(
      NAME,
      JSON.stringify({ state: { theme: 'light', showTaskTokens: false }, version: 0 }),
    );
    expect(mem.getItem('theme')).toBe('light'); // raw string, not JSON-quoted
    expect(mem.getItem('showTaskTokens')).toBe('false'); // legacy bool string
  });

  it('getItem reassembles state from individual keys', () => {
    const mem = createMemoryStorage();
    mem.setItem('theme', 'light');
    mem.setItem('showTaskTokens', 'false');
    const raw = fanOutStorage(mem).getItem(NAME)!;
    expect(JSON.parse(raw).state).toEqual({ theme: 'light', showTaskTokens: false });
  });

  it('absent keys decode to defaults (dark / true)', () => {
    const raw = fanOutStorage(createMemoryStorage()).getItem(NAME)!;
    expect(JSON.parse(raw).state).toEqual({ theme: 'dark', showTaskTokens: true });
  });

  it('round-trips an external reader value untouched', () => {
    const mem = createMemoryStorage();
    mem.setItem('theme', 'light'); // written by some other code path
    const s = fanOutStorage(mem);
    const reloaded = JSON.parse(s.getItem(NAME)!).state.theme;
    expect(reloaded).toBe('light');
  });
});
