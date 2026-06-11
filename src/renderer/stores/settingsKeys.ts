import { type Codec, str, boolDefaultTrue } from './settingsCodecs';

/** The slice of settings managed by settingsStore. Grows as fields migrate. */
export interface SettingsState {
  theme: 'light' | 'dark';
  showTaskTokens: boolean;
}

/** One entry per managed setting: the store field, its existing localStorage
 *  key, and the codec reproducing the legacy on-disk encoding. */
export interface RegistryEntry<K extends keyof SettingsState = keyof SettingsState> {
  field: K;
  key: string;
  codec: Codec<SettingsState[K]>;
}

function entry<K extends keyof SettingsState>(
  field: K,
  key: string,
  codec: Codec<SettingsState[K]>,
): RegistryEntry {
  return { field, key, codec } as RegistryEntry;
}

export const SETTINGS_REGISTRY: RegistryEntry[] = [
  entry('theme', 'theme', str('dark') as Codec<SettingsState['theme']>),
  entry('showTaskTokens', 'showTaskTokens', boolDefaultTrue()),
];

/** Initial state = every field decoded from an absent key (its default). */
export function defaultSettings(): SettingsState {
  const out = {} as SettingsState;
  for (const e of SETTINGS_REGISTRY) {
    (out as Record<string, unknown>)[e.field] = e.codec.decode(null);
  }
  return out;
}
