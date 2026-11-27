import { useEffect } from 'react';
import { useRuntime } from '../stores/runtimeStore';
import { useSettings } from '../stores/settingsStore';
import { sessionRegistry } from './SessionRegistry';

/** Remote control is on: main drops that state with the attach client. */
const remoteControlOn = (id: string) => !!useRuntime.getState().remoteControlStates[id];

/**
 * Applies the "Terminals kept ready" setting and keeps the terminals of tasks
 * with remote control on (see keptTerminals.ts). Lowering the count, or
 * turning remote control off, disposes the extra terminals at once.
 * Mount once, at the app root.
 */
export function useKeptTerminals(): void {
  const keptReady = useSettings((s) => s.terminalsKeptReady);
  useEffect(() => {
    const apply = () => sessionRegistry.setKeptReady(keptReady, remoteControlOn);
    apply();
    // Outside React, so a remote-control change doesn't re-render the app.
    return useRuntime.subscribe((s, prev) => {
      if (s.remoteControlStates !== prev.remoteControlStates) apply();
    });
  }, [keptReady]);
}
