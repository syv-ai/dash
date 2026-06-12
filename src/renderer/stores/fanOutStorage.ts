import { SETTINGS_REGISTRY, type SettingsState } from './settingsKeys';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

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

/** A zustand PersistStorage that stores each settings field under its own legacy
 *  localStorage key (via the registry codecs) instead of one JSON blob. Working
 *  on the real state object means Set/Map-valued fields survive — no whole-state
 *  JSON.stringify pass collapses them. `name` is ignored. */
export function fanOutStorage(backing: StorageLike): PersistStorage<SettingsState> {
  return {
    getItem(_name: string): StorageValue<SettingsState> {
      const state = {} as SettingsState;
      for (const e of SETTINGS_REGISTRY) {
        (state as unknown as Record<string, unknown>)[e.field] = e.codec.decode(
          backing.getItem(e.key),
        );
      }
      return { state, version: 0 };
    },
    setItem(_name: string, value: StorageValue<SettingsState>): void {
      for (const e of SETTINGS_REGISTRY) {
        const v = (value.state as Partial<SettingsState>)[e.field];
        // undefined means "unset" — actively remove the key so a prior value
        // doesn't linger (e.g. commitAttribution returning to default).
        if (v === undefined) backing.removeItem(e.key);
        else backing.setItem(e.key, e.codec.encode(v as never));
      }
    },
    removeItem(_name: string): void {
      for (const e of SETTINGS_REGISTRY) backing.removeItem(e.key);
    },
  };
}
