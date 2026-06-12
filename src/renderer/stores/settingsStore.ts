import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type SettingsState, defaultSettings, SETTINGS_REGISTRY } from './settingsKeys';
import { fanOutStorage, createMemoryStorage, type StorageLike } from './fanOutStorage';
import { runSettingsMigrations } from './settingsMigrations';

/** One plain value-setter per settings field: setTheme(v), setShowTaskTokens(v), … */
type ValueSetters = {
  [K in keyof SettingsState as `set${Capitalize<string & K>}`]: (value: SettingsState[K]) => void;
};

/** Fields whose setter also accepts a functional updater (defined explicitly below). */
interface UpdaterActions {
  setPreferredIDE: (value: string | ((prev: string) => string)) => void;
  setRotationExclusions: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setUnseenTaskIds: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
}

type SettingsActions = Omit<ValueSetters, keyof UpdaterActions> & UpdaterActions;

export type SettingsStore = SettingsState & SettingsActions;

/** Real localStorage in the renderer; memory fallback if window is unavailable. */
function backing(): StorageLike {
  return typeof window !== 'undefined' && window.localStorage
    ? window.localStorage
    : createMemoryStorage();
}

const storageBacking = backing();
runSettingsMigrations(storageBacking);

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => {
      // Value-setters are generated from the registry so a new setting gets its
      // `set<Field>` action for free; the three updater-capable actions below
      // override their generated value-only versions.
      const valueSetters = Object.fromEntries(
        SETTINGS_REGISTRY.map((e) => [
          `set${e.field[0].toUpperCase()}${e.field.slice(1)}`,
          (value: unknown) => set({ [e.field]: value } as Partial<SettingsState>),
        ]),
      ) as unknown as ValueSetters;

      return {
        ...defaultSettings(),
        ...valueSetters,
        setPreferredIDE: (value) =>
          set((s) => ({
            preferredIDE: typeof value === 'function' ? value(s.preferredIDE) : value,
          })),
        setRotationExclusions: (value) =>
          set((s) => ({
            rotationExclusions: typeof value === 'function' ? value(s.rotationExclusions) : value,
          })),
        setUnseenTaskIds: (value) =>
          set((s) => ({
            unseenTaskIds: typeof value === 'function' ? value(s.unseenTaskIds) : value,
          })),
      };
    },
    {
      name: 'settings',
      storage: fanOutStorage(storageBacking),
    },
  ),
);
