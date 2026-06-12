import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  setNotificationSound: (value: SettingsState['notificationSound']) => void;
  setTerminalTheme: (value: string) => void;
  setTerminalFontFamily: (value: string) => void;
  setEffortLevel: (value: string) => void;
  setShellDrawerPosition: (value: SettingsState['shellDrawerPosition']) => void;
  setCustomIDE: (value: SettingsState['customIDE']) => void;
  setCustomClaudeEnvVars: (value: SettingsState['customClaudeEnvVars']) => void;
  setUsageThresholds: (value: SettingsState['usageThresholds']) => void;
  setRotationOrder: (value: SettingsState['rotationOrder']) => void;
  setRotationExclusions: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setUnseenTaskIds: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setDiffContextLines: (value: SettingsState['diffContextLines']) => void;
  setCommitAttribution: (value: SettingsState['commitAttribution']) => void;
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
      setNotificationSound: (notificationSound) => set({ notificationSound }),
      setTerminalTheme: (terminalTheme) => set({ terminalTheme }),
      setTerminalFontFamily: (terminalFontFamily) => set({ terminalFontFamily }),
      setEffortLevel: (effortLevel) => set({ effortLevel }),
      setShellDrawerPosition: (shellDrawerPosition) => set({ shellDrawerPosition }),
      setCustomIDE: (customIDE) => set({ customIDE }),
      setCustomClaudeEnvVars: (customClaudeEnvVars) => set({ customClaudeEnvVars }),
      setUsageThresholds: (usageThresholds) => set({ usageThresholds }),
      setRotationOrder: (rotationOrder) => set({ rotationOrder }),
      setRotationExclusions: (value) =>
        set((s) => ({
          rotationExclusions: typeof value === 'function' ? value(s.rotationExclusions) : value,
        })),
      setUnseenTaskIds: (value) =>
        set((s) => ({
          unseenTaskIds: typeof value === 'function' ? value(s.unseenTaskIds) : value,
        })),
      setDiffContextLines: (diffContextLines) => set({ diffContextLines }),
      setCommitAttribution: (commitAttribution) => set({ commitAttribution }),
    }),
    {
      name: 'settings',
      storage: fanOutStorage(backing()),
    },
  ),
);
