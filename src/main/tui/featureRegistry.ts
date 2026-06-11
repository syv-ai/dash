import type { BrowserWindow } from 'electron';
import type { SpawnOpts } from './SidecarTuiHost';

/** Payload of the tui:requestStart IPC (minus featureId, which routes it). */
export interface RequestStartPayload {
  taskId: string;
  projectId: string;
  taskName: string;
  projectName: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TuiFeature {
  id: string;
  /** Wire the feature's flow + env into a host SpawnOpts for the request path. */
  buildSpawn(payload: RequestStartPayload, getMainWindow: () => BrowserWindow | null): SpawnOpts;
  /**
   * Cheap pre-spawn gate: false means the feature has nothing to offer for
   * this task (e.g. ports onboarding when .dash/ports.json already exists).
   * Absent = always relevant.
   */
  isRelevant?(payload: RequestStartPayload): boolean;
}

const features = new Map<string, TuiFeature>();

export function registerFeature(feature: TuiFeature): void {
  features.set(feature.id, feature);
}

export function getFeature(id: string): TuiFeature | undefined {
  return features.get(id);
}
