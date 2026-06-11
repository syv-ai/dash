import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { type SettingsState, defaultSettings } from './settingsKeys';
import { fanOutStorage, createMemoryStorage, type StorageLike } from './fanOutStorage';

interface SettingsActions {
  setTheme: (theme: SettingsState['theme']) => void;
  setShowTaskTokens: (value: boolean) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

/** Real localStorage in the renderer; memory fallback if window is unavailable. */
function backing(): StorageLike {
  return typeof window !== 'undefined' && window.localStorage
    ? window.localStorage
    : createMemoryStorage();
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings(),
      setTheme: (theme) => set({ theme }),
      setShowTaskTokens: (showTaskTokens) => set({ showTaskTokens }),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => fanOutStorage(backing())),
    },
  ),
);
