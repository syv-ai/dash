import { app } from 'electron';
import { DatabaseService } from '../services/DatabaseService';
import { createRegistry, type Registry } from './registry';
import { writeLauncher } from './launcher';
import { controlPaths } from './paths';
import { ControlServer } from './server';
import { initTokens, setOrchestratorFile } from './tokens';
import { setReadOnlyCapabilities } from './mcpConfig';
import { noteTaskContact } from './shimContacts';
import { registerProjectCapabilities } from './capabilities/projects';
import { registerTaskCapabilities } from './capabilities/tasks';
import { registerServiceCapabilities } from './capabilities/services';
import { projectDeps, serviceDeps, taskDeps } from './capabilities/appDeps';
import type { ControlInfo } from '../../shared/types';

/**
 * The control API's entry point: the only module outside `control/` imports.
 * Started after the HookServer at boot, stopped after it at quit.
 */

/** The app's capability registry, scoped against the real DB. */
export const registry: Registry = createRegistry({
  getProjects: () => DatabaseService.getProjects(),
  getTask: (id) => DatabaseService.getTask(id),
});

let server: ControlServer | null = null;
let tokensReady = false;
let capabilitiesRegistered = false;
// Off until Settings turns it on (Task 12 restores the saved value at boot).
let orchestratorAccess = false;

/** Registers every capability. Each capability module adds itself here. */
function registerCapabilities(): void {
  if (capabilitiesRegistered) return;
  capabilitiesRegistered = true;
  registerProjectCapabilities(registry, projectDeps());
  registerTaskCapabilities(registry, taskDeps());
  registerServiceCapabilities(registry, serviceDeps());
  setReadOnlyCapabilities(registry.readOnlyNames());
}

export async function startControl(): Promise<void> {
  if (server) return;
  if (process.platform === 'win32') {
    // The shim launcher is a shell script, like the hook commands; no win32 path.
    console.error('[control] Control API is not available on Windows; not starting');
    return;
  }
  initTokens(app.getPath('userData'));
  tokensReady = true;
  // Drops a stale orchestrator-token file left by a crash while access was on.
  setOrchestratorFile(orchestratorAccess);
  registerCapabilities();
  const next = new ControlServer({
    userDataDir: app.getPath('userData'),
    registry,
    isOrchestratorAllowed: () => orchestratorAccess,
    onTaskContact: noteTaskContact,
  });
  await next.start();
  server = next;
  try {
    writeLauncher(app.getPath('userData'));
  } catch (err) {
    // Best effort: the API still runs, and last boot's launcher may still point somewhere valid.
    console.error('[control] Failed to write the dash-mcp launcher:', err);
  }
}

export async function stopControl(): Promise<void> {
  const current = server;
  server = null;
  await current?.stop();
}

/** The Settings switch: gates orchestrator calls and writes or removes its token file. */
export function setOrchestratorAccess(enabled: boolean): void {
  orchestratorAccess = enabled;
  if (!tokensReady) return; // applied by startControl
  try {
    setOrchestratorFile(enabled);
  } catch (err) {
    console.error('[control] Failed to update the orchestrator token file:', err);
  }
}

/** For Settings: the launcher a `claude mcp add` command points at, and whether the API runs here. */
export function controlInfo(): ControlInfo {
  return {
    launcherPath: controlPaths(app.getPath('userData')).launcher,
    supported: process.platform !== 'win32',
  };
}
