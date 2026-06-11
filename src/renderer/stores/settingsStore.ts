import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { type SettingsState, defaultSettings } from './settingsKeys';
import { fanOutStorage, createMemoryStorage, type StorageLike } from './fanOutStorage';

interface SettingsActions {
  setTheme: (theme: SettingsState['theme']) => void;
  setShowTaskTokens: (value: boolean) => void;
  setShowRateLimits: (value: boolean) => void;
  setShowUsageInline: (value: boolean) => void;
  setShowContextUsageOnTaskCards: (value: boolean) => void;
  setShowActiveTasksSection: (value: boolean) => void;
  setShowProjectTokens: (value: boolean) => void;
  setDesktopNotification: (value: boolean) => void;
  setSyncShellEnv: (value: boolean) => void;
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
      setShowRateLimits: (showRateLimits) => set({ showRateLimits }),
      setShowUsageInline: (showUsageInline) => set({ showUsageInline }),
      setShowContextUsageOnTaskCards: (showContextUsageOnTaskCards) =>
        set({ showContextUsageOnTaskCards }),
      setShowActiveTasksSection: (showActiveTasksSection) => set({ showActiveTasksSection }),
      setShowProjectTokens: (showProjectTokens) => set({ showProjectTokens }),
      setDesktopNotification: (desktopNotification) => set({ desktopNotification }),
      setSyncShellEnv: (syncShellEnv) => set({ syncShellEnv }),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => fanOutStorage(backing())),
    },
  ),
);
