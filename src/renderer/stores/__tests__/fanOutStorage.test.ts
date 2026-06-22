import { describe, it, expect } from 'vitest';
import type { StorageValue } from 'zustand/middleware';
import { createMemoryStorage, fanOutStorage, type StorageLike } from '../fanOutStorage';
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

  it('writes only the keys whose encoded value changed', () => {
    const mem = createMemoryStorage();
    let writes = 0;
    const counting: StorageLike = {
      getItem: (k) => mem.getItem(k),
      setItem: (k, v) => {
        writes++;
        mem.setItem(k, v);
      },
      removeItem: (k) => {
        writes++;
        mem.removeItem(k);
      },
    };
    const s = fanOutStorage(counting);

    s.setItem(NAME, { state: { theme: 'light', showTaskTokens: false } as never, version: 0 });
    expect(writes).toBe(2); // theme + showTaskTokens

    // Re-persisting the same state writes nothing.
    writes = 0;
    s.setItem(NAME, { state: { theme: 'light', showTaskTokens: false } as never, version: 0 });
    expect(writes).toBe(0);

    // Changing one field writes only that key.
    writes = 0;
    s.setItem(NAME, { state: { theme: 'dark', showTaskTokens: false } as never, version: 0 });
    expect(writes).toBe(1);
  });

  it('removes the key when a field is undefined (e.g. commitAttribution default)', () => {
    const mem = createMemoryStorage();
    mem.setItem('commitAttribution', 'old custom text'); // a stale prior value
    fanOutStorage(mem).setItem(NAME, {
      state: { commitAttribution: undefined } as never,
      version: 0,
    });
    expect(mem.getItem('commitAttribution')).toBeNull();
  });
});
