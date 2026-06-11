import {
  type Codec,
  str,
  boolDefaultTrue,
  boolDefaultFalse,
  boolNotFalse,
  strEnum,
  json,
} from './settingsCodecs';
import type { NotificationSound } from '../sounds';
import type { UsageThresholds } from '@shared/types';

/** The slice of settings managed by settingsStore. Grows as fields migrate. */
export interface SettingsState {
  theme: 'light' | 'dark';
  showTaskTokens: boolean;
  showRateLimits: boolean;
  showUsageInline: boolean;
  showContextUsageOnTaskCards: boolean;
  showActiveTasksSection: boolean;
  showProjectTokens: boolean;
  desktopNotification: boolean;
  syncShellEnv: boolean;
  notificationSound: NotificationSound;
  terminalTheme: string;
  terminalFontFamily: string;
  effortLevel: string;
  shellDrawerPosition: 'main' | 'right';
  customIDE: { path: string; args: string[] };
  customClaudeEnvVars: Record<string, string>;
  usageThresholds: UsageThresholds;
  rotationOrder: string[];
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
  entry('showRateLimits', 'showRateLimits', boolNotFalse()),
  entry('showUsageInline', 'showUsageInline', boolNotFalse()),
  entry('showContextUsageOnTaskCards', 'showContextUsageOnTaskCards', boolNotFalse()),
  entry('showActiveTasksSection', 'showActiveTasksSection', boolNotFalse()),
  entry('showProjectTokens', 'showProjectTokens', boolDefaultTrue()),
  entry('desktopNotification', 'desktopNotification', boolDefaultFalse()),
  entry('syncShellEnv', 'syncShellEnv', boolDefaultFalse()),
  entry('notificationSound', 'notificationSound', str('off') as Codec<NotificationSound>),
  entry('terminalTheme', 'terminalTheme', str('default')),
  entry('terminalFontFamily', 'terminalFontFamily', str('system')),
  entry('effortLevel', 'claudeEffortLevel', str('auto')),
  entry('shellDrawerPosition', 'shellDrawerPosition', strEnum(['main', 'right'] as const, 'right')),
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
];

/** Initial state = every field decoded from an absent key (its default). */
export function defaultSettings(): SettingsState {
  const out = {} as SettingsState;
  for (const e of SETTINGS_REGISTRY) {
    (out as unknown as Record<string, unknown>)[e.field] = e.codec.decode(null);
  }
  return out;
}
