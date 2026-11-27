import { healthLevel, type HealthReading, type MemoryPressure } from '@shared/systemHealth';

/**
 * When to warn about memory: once on the way up, then not again until usage
 * falls back under REARM_RATIO of the threshold (and the OS no longer reports
 * pressure) and crosses again, or until COOLDOWN_MS has passed while still
 * over. Pure; SystemHealthService feeds it one sample at a time.
 */

/** Usage must fall under this share of the threshold to re-arm. */
export const REARM_RATIO = 0.9;
/** A warning repeats after this long over the line, re-armed or not. */
export const COOLDOWN_MS = 2 * 60 * 60_000;

export interface AlertState {
  /** The next crossing warns. */
  armed: boolean;
  /** When the last warning went out (ms), or null. */
  lastAlertAt: number | null;
}

export const INITIAL_ALERT_STATE: AlertState = { armed: true, lastAlertAt: null };

export interface AlertSample extends HealthReading {
  now: number;
}

export type AlertReason = 'threshold' | 'pressure';

export interface AlertStep {
  state: AlertState;
  /** Set when this sample should warn. */
  alert: AlertReason | null;
}

/** macOS `sysctl -n kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical. */
export function parsePressureLevel(stdout: string): MemoryPressure | null {
  switch (stdout.trim()) {
    case '1':
      return 'normal';
    case '2':
      return 'warn';
    case '4':
      return 'critical';
    default:
      return null;
  }
}

export function stepAlert(state: AlertState, s: AlertSample): AlertStep {
  // The icon's verdict: anything but ok is over.
  const over = healthLevel(s) !== 'ok';

  if (!over) {
    const settled = s.totalBytes < s.thresholdBytes * REARM_RATIO;
    return { state: settled && !state.armed ? { ...state, armed: true } : state, alert: null };
  }

  const cooledDown = state.lastAlertAt !== null && s.now - state.lastAlertAt >= COOLDOWN_MS;
  if (!state.armed && !cooledDown) return { state, alert: null };
  return {
    state: { armed: false, lastAlertAt: s.now },
    alert: s.totalBytes >= s.thresholdBytes ? 'threshold' : 'pressure',
  };
}
