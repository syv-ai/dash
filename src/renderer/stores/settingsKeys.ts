import {
  type Codec,
  str,
  boolDefaultTrue,
  boolDefaultFalse,
  boolNotFalse,
  strEnum,
  json,
  stringSet,
  strOrUndefined,
} from './settingsCodecs';
import { clampKeptReady } from '../terminal/keptTerminals';
import { TERMINAL_THEME_IDS } from '../terminal/terminalThemes';
import type { NotificationSound } from '../sounds';
import type { UsageThresholds } from '@shared/types';
import { clampMemoryWarningGb } from '@shared/systemHealth';
import { AUTO_SLEEP_CHOICES, type AutoSleepAfter } from '../lib/autoSleep';
import { parseKeybindings, type KeyBindingMap } from '../keybindings';

/** The slice of settings managed by settingsStore. Grows as fields migrate. */
export interface SettingsState {
  theme: 'light' | 'dark';
  showTaskTokens: boolean;
  showTaskCost: boolean;
  showRateLimits: boolean;
  showUsageInline: boolean;
  /** Pace beside the limits in the right sidebar's usage row (D33). */
  showPace: boolean;
  /** The left sidebar's view: the project tree (the default) or the
   *  state-ordered task list. */
  sidebarView: 'tasks' | 'projects';
  /** The Tasks view's "Sleeping tasks" group is open. */
  sleepingTasksOpen: boolean;
  showProjectTokens: boolean;
  desktopNotification: boolean;
  syncShellEnv: boolean;
  ultracode: boolean;
  /** `claude stop` every task session when Dash quits. Off: sessions keep
   *  running under Claude Code's supervisor and resume on the next attach. */
  stopSessionsOnQuit: boolean;
  /** Let an orchestrator outside Dash (e.g. a Holi agent) use the control API
   *  through dashctl. Off by default. */
  orchestratorAccess: boolean;
  notificationSound: NotificationSound;
  terminalTheme: string;
  terminalFontFamily: string;
  /** "Terminals kept ready": how many recently viewed task terminals stay
   *  ready, attach client and all (see keptTerminals). Clamped to
   *  KEPT_READY_MIN..MAX. */
  terminalsKeptReady: number;
  effortLevel: string;
  customIDE: { path: string; args: string[] };
  customClaudeEnvVars: Record<string, string>;
  usageThresholds: UsageThresholds;
  rotationOrder: string[];
  rotationExclusions: Set<string>;
  unseenTaskIds: Set<string>;
  commitAttribution: string | undefined;
  preferredIDE: string;
  keybindings: KeyBindingMap;
  sidebarCollapsed: boolean;
  changesPanelCollapsed: boolean;
  shellDrawerCollapsed: boolean;
  portsDrawerCollapsed: boolean;
  autoUpdateEnabled: boolean;
  updateNotificationsEnabled: boolean;
  lastSeenReleaseNotesVersion: string | undefined;
  /** Warn when Dash and its sessions use more memory than `memoryWarningGb`,
   *  or the OS reports memory pressure (SystemHealthService). */
  memoryWarning: boolean;
  /** The memory warning's and the health icon's threshold in GB (clampMemoryWarningGb). */
  memoryWarningGb: number;
  /** The health icon beside Settings, coloured by `healthLevel`. */
  systemHealthIcon: boolean;
  /** Put a session to sleep once it has rested, seen, this long (autoSleep.ts). Off by default. */
  autoSleepAfter: AutoSleepAfter;
}

/** One entry per managed setting: the store field, its existing localStorage
 *  key, and the codec reproducing the legacy on-disk encoding. */
export interface RegistryEntry<K extends keyof SettingsState = keyof SettingsState> {
  field: K;
  key: string;
  codec: Codec<SettingsState[K]>;
}

/** Legacy shape guard for customIDE — matches the old App.tsx parse check. */
function isCustomIDE(v: unknown): boolean {
  const o = v as { path?: unknown; args?: unknown } | null;
  return !!o && typeof o.path === 'string' && Array.isArray(o.args);
}

/** Keybindings codec: decode merges stored over defaults (via parseKeybindings). */
function keybindingsCodec(): Codec<KeyBindingMap> {
  return {
    decode: (raw) => parseKeybindings(raw),
    encode: (v) => JSON.stringify(v),
  };
}

function entry<K extends keyof SettingsState>(
  field: K,
  key: string,
  codec: Codec<SettingsState[K]>,
): RegistryEntry {
  return { field, key, codec } as unknown as RegistryEntry;
}

export const SETTINGS_REGISTRY: RegistryEntry[] = [
  entry('theme', 'theme', str('dark') as Codec<SettingsState['theme']>),
  entry('showTaskTokens', 'showTaskTokens', boolDefaultTrue()),
  entry('showTaskCost', 'showTaskCost', boolDefaultTrue()),
  entry('showRateLimits', 'showRateLimits', boolNotFalse()),
  entry('showUsageInline', 'showUsageInline', boolNotFalse()),
  // Renamed from showBurnRate (D248); the stored key stays, so the opt-in carries over.
  entry('showPace', 'showBurnRate', boolDefaultFalse()),
  // Removed keys (showActiveTasksSection, showContextUsageOnTaskCards,
  // showContextBarOnTaskCards, shellDrawerPosition) are simply no longer read;
  // stored values linger, unused.
  entry('sidebarView', 'sidebarView', strEnum(['tasks', 'projects'] as const, 'projects')),
  // Renamed from inactiveSessionsOpen; the stored key stays, so the fold carries over.
  entry('sleepingTasksOpen', 'inactiveSessionsOpen', boolDefaultFalse()),
  entry('showProjectTokens', 'showProjectTokens', boolDefaultTrue()),
  entry('desktopNotification', 'desktopNotification', boolDefaultFalse()),
  entry('syncShellEnv', 'syncShellEnv', boolDefaultFalse()),
  entry('ultracode', 'ultracode', boolDefaultFalse()),
  entry('stopSessionsOnQuit', 'stopSessionsOnQuit', boolDefaultFalse()),
  entry('orchestratorAccess', 'orchestratorAccess', boolDefaultFalse()),
  entry('notificationSound', 'notificationSound', str('off') as Codec<NotificationSound>),
  // A removed palette (e.g. the old 'legacy') falls back to the default.
  entry('terminalTheme', 'terminalTheme', strEnum(TERMINAL_THEME_IDS, 'default')),
  entry('terminalFontFamily', 'terminalFontFamily', str('system')),
  // parseFloat gives NaN for absent, empty or garbage values; clampKeptReady
  // maps NaN to the default. Replaces webglHeldLimit (see settingsMigrations).
  entry('terminalsKeptReady', 'terminalsKeptReady', {
    decode: (raw) => clampKeptReady(parseFloat(raw ?? '')),
    encode: (v) => String(v),
  }),
  entry('effortLevel', 'claudeEffortLevel', str('auto')),
  entry(
    'customIDE',
    'customIDE',
    json({ path: '', args: [] as string[] }, isCustomIDE) as Codec<SettingsState['customIDE']>,
  ),
  entry('customClaudeEnvVars', 'customClaudeEnvVars', json<Record<string, string>>({})),
  entry(
    'usageThresholds',
    'usageThresholds',
    json<UsageThresholds>({
      contextPercentage: 80,
      fiveHourPercentage: null,
      sevenDayPercentage: null,
    }),
  ),
  entry('rotationOrder', 'rotationOrder', json<string[]>([])),
  entry('rotationExclusions', 'rotationExclusions', stringSet()),
  entry('unseenTaskIds', 'unseenTaskIds', stringSet()),
  entry('commitAttribution', 'commitAttribution', strOrUndefined()),
  entry('preferredIDE', 'preferredIDE', str('auto')),
  entry('keybindings', 'keybindings', keybindingsCodec()),
  entry('sidebarCollapsed', 'sidebarCollapsed', boolDefaultFalse()),
  entry('changesPanelCollapsed', 'changesPanelCollapsed', boolDefaultFalse()),
  entry('shellDrawerCollapsed', 'shellDrawerCollapsed', boolDefaultFalse()),
  entry('portsDrawerCollapsed', 'portsDrawerCollapsed', boolDefaultTrue()),
  entry('autoUpdateEnabled', 'autoUpdateEnabled', boolDefaultTrue()),
  entry('updateNotificationsEnabled', 'updateNotificationsEnabled', boolDefaultTrue()),
  entry('lastSeenReleaseNotesVersion', 'lastSeenReleaseNotesVersion', strOrUndefined()),
  entry('memoryWarning', 'memoryWarning', boolDefaultTrue()),
  // parseFloat gives NaN for absent or garbage values; the clamp maps NaN to the default.
  entry('memoryWarningGb', 'memoryWarningGb', {
    decode: (raw) => clampMemoryWarningGb(parseFloat(raw ?? '')),
    encode: (v) => String(v),
  }),
  entry('systemHealthIcon', 'systemHealthIcon', boolDefaultTrue()),
  entry('autoSleepAfter', 'autoSleepAfter', strEnum(AUTO_SLEEP_CHOICES, 'off')),
];

/** Initial state = every field decoded from an absent key (its default). */
export function defaultSettings(): SettingsState {
  const out = {} as SettingsState;
  for (const e of SETTINGS_REGISTRY) {
    (out as unknown as Record<string, unknown>)[e.field] = e.codec.decode(null);
  }
  return out;
}
