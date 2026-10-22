import { useEffect, useState } from 'react';
import type { ControlInfo } from '../../shared/types';

// Fixed for the app's lifetime, so it's fetched once and shared by every caller.
let cached: ControlInfo | null = null;
let pending: Promise<ControlInfo | null> | null = null;

function load(): Promise<ControlInfo | null> {
  pending ??= window.electronAPI
    .getControlInfo()
    .then((resp) => {
      cached = resp.success && resp.data ? resp.data : null;
      return cached;
    })
    .catch(() => null);
  return pending;
}

/**
 * The control API's launcher path and whether it runs on this platform. Null
 * until loaded; every Dash access toggle stays hidden until `supported` is true.
 */
export function useControlInfo(): ControlInfo | null {
  const [info, setInfo] = useState<ControlInfo | null>(cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    void load().then((next) => {
      if (live) setInfo(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return info;
}
