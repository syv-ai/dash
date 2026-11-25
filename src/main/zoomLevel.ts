import * as fs from 'fs';

/*
 * The zoom level's rules and its file, pure of Electron so they're tested
 * under plain Node (`zoom.ts` wires them to the windows and the menu).
 */

/** Where the app opens and "Actual Size" returns. */
export const DEFAULT_ZOOM_LEVEL = 0.5;
/** One Zoom In / Zoom Out step, Chromium's. */
const ZOOM_STEP = 0.5;
/** Bounds on the level (≈ ×0.58 … ×2.49), a few steps either side. */
const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 5;

export type ZoomCommand = 'in' | 'out' | 'reset';

/** The level a command leads to from `current`, within bounds. Pure. */
export function nextZoomLevel(current: number, command: ZoomCommand): number {
  if (command === 'reset') return DEFAULT_ZOOM_LEVEL;
  const next = current + (command === 'in' ? ZOOM_STEP : -ZOOM_STEP);
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, next));
}

/** The stored level in `file`, or the default when absent or unreadable. */
export function readZoomLevel(file: string): number {
  try {
    const { level } = JSON.parse(fs.readFileSync(file, 'utf-8')) as { level?: unknown };
    if (typeof level === 'number' && Number.isFinite(level)) {
      return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level));
    }
  } catch {
    // Missing or corrupt: the default.
  }
  return DEFAULT_ZOOM_LEVEL;
}

export function writeZoomLevel(file: string, level: number): void {
  try {
    fs.writeFileSync(file, JSON.stringify({ level }), 'utf-8');
  } catch (err) {
    console.error('[zoom] Could not save the zoom level:', err);
  }
}
