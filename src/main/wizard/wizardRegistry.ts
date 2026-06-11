import type { BrowserWindow } from 'electron';
import type { SpawnOpts } from '../tui/SidecarTuiHost';

/** Payload of the wizard:requestStart IPC (minus featureId, which routes it). */
export interface RequestStartPayload {
  taskId: string;
  projectId: string;
  taskName: string;
  projectName: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface Wizard {
  /** Feature id this wizard belongs to (routes the request, tags its tab). */
  id: string;
  /** Wire this wizard's orchestrator + env into a host SpawnOpts for the request path. */
  buildSpawn(payload: RequestStartPayload, getMainWindow: () => BrowserWindow | null): SpawnOpts;
  /**
   * Cheap pre-spawn gate: false means the wizard has nothing to offer for
   * this task (e.g. ports onboarding when .dash/ports.json already exists).
   * Absent = always relevant.
   */
  isRelevant?(payload: RequestStartPayload): boolean;
}

const wizards = new Map<string, Wizard>();

export function registerWizard(wizard: Wizard): void {
  wizards.set(wizard.id, wizard);
}

export function getWizard(id: string): Wizard | undefined {
  return wizards.get(id);
}
