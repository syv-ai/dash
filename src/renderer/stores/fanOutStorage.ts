import { SETTINGS_REGISTRY, type SettingsState } from './settingsKeys';

/** Minimal Web Storage surface we depend on — injectable for tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory StorageLike for unit tests (no window/localStorage in node env). */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A zustand StateStorage (string in/out) that stores each settings field under
 *  its own legacy localStorage key instead of one blob. `name` is ignored. */
export function fanOutStorage(backing: StorageLike) {
  return {
    getItem(_name: string): string | null {
      const state = {} as SettingsState;
      for (const e of SETTINGS_REGISTRY) {
        (state as unknown as Record<string, unknown>)[e.field] = e.codec.decode(
          backing.getItem(e.key),
        );
      }
      return JSON.stringify({ state, version: 0 });
    },
    setItem(_name: string, value: string): void {
      const parsed = JSON.parse(value) as { state: Partial<SettingsState> };
      for (const e of SETTINGS_REGISTRY) {
        const v = parsed.state[e.field];
        if (v !== undefined) {
          backing.setItem(e.key, e.codec.encode(v as never));
        }
      }
    },
    removeItem(_name: string): void {
      for (const e of SETTINGS_REGISTRY) backing.removeItem(e.key);
    },
  };
}
