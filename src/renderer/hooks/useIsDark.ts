import { useSyncExternalStore } from 'react';
import { useSettings } from '../stores/settingsStore';
import { SYSTEM_DARK_QUERY, resolveIsDark } from '../lib/theme';

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(SYSTEM_DARK_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const systemDark = () => window.matchMedia(SYSTEM_DARK_QUERY).matches;

/**
 * Whether the app draws dark now: Settings → Appearance's theme, and under
 * System the OS's appearance, followed live. The one source for the root
 * class, Monaco and the terminals.
 */
export function useIsDark(): boolean {
  const choice = useSettings((s) => s.theme);
  const dark = useSyncExternalStore(subscribe, systemDark);
  return resolveIsDark(choice, dark);
}
