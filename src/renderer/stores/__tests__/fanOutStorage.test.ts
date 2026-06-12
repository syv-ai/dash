import { describe, it, expect } from 'vitest';
import type { StorageValue } from 'zustand/middleware';
import { createMemoryStorage, fanOutStorage } from '../fanOutStorage';
import type { SettingsState } from '../settingsKeys';

const NAME = 'settings';

/** getItem is synchronous in this adapter; narrow away the Promise/null arms. */
function read(backing: ReturnType<typeof createMemoryStorage>): StorageValue<SettingsState> {
  return fanOutStorage(backing).getItem(NAME) as StorageValue<SettingsState>;
}

describe('fanOutStorage (PersistStorage)', () => {
  it('setItem fans each field out to its own key in legacy encoding', () => {
    const mem = createMemoryStorage();
    fanOutStorage(mem).setItem(NAME, {
      state: { theme: 'light', showTaskTokens: false } as never,
      version: 0,
    });
    expect(mem.getItem('theme')).toBe('light'); // raw string, not JSON-quoted
    expect(mem.getItem('showTaskTokens')).toBe('false'); // legacy bool string
  });

  it('getItem reassembles state from individual keys', () => {
    const mem = createMemoryStorage();
    mem.setItem('theme', 'light');
    mem.setItem('showTaskTokens', 'false');
    expect(read(mem).state).toMatchObject({ theme: 'light', showTaskTokens: false });
  });

  it('absent keys decode to defaults (dark / true)', () => {
    expect(read(createMemoryStorage()).state).toMatchObject({
      theme: 'dark',
      showTaskTokens: true,
    });
  });

  it('round-trips an external reader value untouched', () => {
    const mem = createMemoryStorage();
    mem.setItem('theme', 'light');
    expect(read(mem).state.theme).toBe('light');
  });
});
