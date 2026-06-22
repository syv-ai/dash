import { app, type BrowserWindow } from 'electron';
import path from 'path';
import * as fs from 'fs';
import { registerWizard, type RequestStartPayload } from '../wizardRegistry';
import type { SpawnOpts } from '../WizardHost';
import { getTuiHost } from '../../tui/hostInstance';
import { PortsOnboardingWizard } from './PortsOnboardingWizard';
import { PortsSetupWizard } from './PortsSetupWizard';
import { portsOnboardingRelevant } from './relevance';
import { detectPortsNeed } from '../../services/PortsHeuristic';
import { buildPortsSetupPrompt } from '../../services/PortsSetupPrompt';
import { WorkspacePortsRuntime } from '../../services/WorkspacePortsRuntime';
import {
  events as portsConfigEvents,
  ensureWatching as ensurePortsConfigWatch,
} from '../../services/PortsConfigWatcher';
import { DatabaseService } from '../../services/DatabaseService';
import { worktreeService } from '../../services/WorktreeService';
import { setInitialPrompt } from '../../services/ptyManager';

const FEATURE_ID = 'ports';

export function registerPortsWizard(): void {
  registerWizard({
    id: FEATURE_ID,
    buildSpawn: (payload, getMainWindow) => onboardingSpawn(payload, getMainWindow),
    // Relevant only when the worktree has no ports config yet AND the heuristic
    // actually detects port-using services — otherwise we'd spawn a side-car
    // just to have the onboarding flow find nothing and tear down.
    isRelevant: (payload) =>
      portsOnboardingRelevant(payload.cwd) && detectPortsNeed(payload.cwd).needsPorts,
    isComplete: (cwd) => !portsOnboardingRelevant(cwd),
  });
}

/** Renderer-requested path: offer ports setup for the user's current task. */
function onboardingSpawn(
  payload: RequestStartPayload,
  getMainWindow: () => BrowserWindow | null,
): SpawnOpts {
  return {
    featureId: FEATURE_ID,
    taskId: payload.taskId,
    projectId: payload.projectId,
    cwd: payload.cwd,
    getMainWindow,
    createWizard: (wiring) =>
      new PortsOnboardingWizard(payload.taskId, payload.projectId, wiring as never, {
        heuristic: async () => {
          const result = detectPortsNeed(payload.cwd);
          return {
            signals: result.signals,
            guesses: result.guesses.map((g) => `${g.label} (${g.envVar} @ ${g.defaultPort})`),
          };
        },
        markDismissed: () => DatabaseService.markFeatureDismissed(payload.projectId, FEATURE_ID),
        migrate: ({ signals, guesses }) =>
          handleMigrate({
            currentTaskId: payload.taskId,
            currentProjectId: payload.projectId,
            signals,
            guesses,
            getMainWindow,
          }),
      }),
  };
}

/** Migrate-spawned path: drive the agent's setup run in the new task. */
function setupSpawn(args: {
  taskId: string;
  projectId: string;
  cwd: string;
  getMainWindow: () => BrowserWindow | null;
}): SpawnOpts {
  return {
    featureId: FEATURE_ID,
    taskId: args.taskId,
    projectId: args.projectId,
    cwd: args.cwd,
    getMainWindow: args.getMainWindow,
    createWizard: (wiring) =>
      new PortsSetupWizard(args.taskId, args.projectId, wiring as never, {
        portsEvents: portsConfigEvents,
        getPortCount: async (tid: string) => WorkspacePortsRuntime.getPortsForTask(tid).length,
        restartAllForTask: async (tid: string) => {
          const win = args.getMainWindow();
          win?.webContents.send('ports:restart-task', tid);
        },
      }),
  };
}

/**
 * Migrate path: the user picked "Set it up" on the ONBOARDING screen. We:
 *   1. Create a `port-setup` worktree task on a new branch from the project's
 *      default base (push to remote is skipped — this branch is local-only
 *      throwaway in the common case).
 *   2. Persist the task in SQLite.
 *   3. Ask the renderer to switch its active task to the new one (the
 *      renderer's requestStart effect won't race in: the host's pending set
 *      is populated synchronously by the spawn call below).
 *   4. Spawn a PortsSetupWizard TUI for the new task.
 */
async function handleMigrate(args: {
  currentTaskId: string;
  currentProjectId: string;
  signals: string[];
  guesses: string[];
  getMainWindow: () => BrowserWindow | null;
}): Promise<void> {
  const project = DatabaseService.getProjects().find((p) => p.id === args.currentProjectId);
  if (!project) throw new Error(`project ${args.currentProjectId} not found`);

  const worktreeInfo = await worktreeService.createWorktree(project.path, 'port-setup', {
    projectId: args.currentProjectId,
    pushRemote: false,
  });

  const task = DatabaseService.saveTask({
    id: worktreeInfo.id,
    projectId: args.currentProjectId,
    name: 'port-setup',
    branch: worktreeInfo.branch,
    path: worktreeInfo.path,
    useWorktree: true,
    branchCreatedByDash: true,
  });

  // Arm the file watcher so the setup flow hears about it when the agent
  // writes .dash/ports.json and the sentinel. We mkdir `.dash/` defensively
  // so `fs.watch` attaches immediately — ensureWatching would also retry on
  // a later call, but doing it eagerly avoids a race where the agent races
  // us to write ports.json before anything re-ensures the watcher.
  try {
    const dashDir = path.join(task.path, '.dash');
    if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true });
    WorkspacePortsRuntime.setupTask({ taskId: task.id, worktreePath: task.path });
    ensurePortsConfigWatch(task.id, task.path);
  } catch (err) {
    console.error('[ports] migrate bootstrap failed', err);
  }

  // Stash the FULL setup prompt as the agent's initial positional arg.
  // CC auto-submits this once the user accepts the trust gate, so the user
  // goes "click new task → dismiss trust modal → setup runs" with zero
  // interaction in the Ports tab — and no slash-command .md file in the new
  // worktree (no per-worktree footprint, no .gitignore mutation).
  try {
    const setupPrompt = buildPortsSetupPrompt({
      signals: args.signals,
      guesses: args.guesses,
    });
    setInitialPrompt(task.id, setupPrompt);
  } catch (err) {
    // Best effort — if the builder somehow fails, the setup flow still
    // surfaces the 30-min ports.json timeout, and the user can re-run
    // setup from the Dash UI.
    console.error('[ports] migrate initial-prompt build failed', err);
  }

  // Kick off the spawn synchronously so the host's pending set contains the
  // new task before we notify the renderer — its requestStart effect checks
  // wizard:active (pending ∪ active ∪ suppressed) and bails. We still await
  // afterwards so failures surface to the onboarding flow's migrate() caller.
  const spawnPromise = getTuiHost().spawn(
    setupSpawn({
      taskId: task.id,
      projectId: args.currentProjectId,
      cwd: task.path,
      getMainWindow: args.getMainWindow,
    }),
  );

  const win = args.getMainWindow();
  win?.webContents.send('ports:tui:migrated', {
    fromTaskId: args.currentTaskId,
    toTaskId: task.id,
    projectId: args.currentProjectId,
  });

  try {
    await spawnPromise;
  } catch (err) {
    // The renderer has already switched to the new task, so the old TUI's
    // error screen (rendered by our caller's exit('error')) is off-screen.
    // Surface the failure where the user is actually looking.
    const w = args.getMainWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send('app:toast', {
        message: `Port-setup TUI failed to start: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    throw err;
  }
}

/**
 * One-time best-effort migration from the legacy dismissed-projects.json file
 * (used by the pre-DB ports onboarding) into feature_dismissals. Runs at
 * boot; deletes the file once each id has been marked dismissed.
 */
export function migrateLegacyPortsDismissals(): void {
  const legacyPath = path.join(app.getPath('userData'), 'dismissed-projects.json');
  let state: Record<string, true> = {};
  try {
    state = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch {
    return; // no file, nothing to migrate
  }
  for (const pid of Object.keys(state)) {
    try {
      DatabaseService.markFeatureDismissed(pid, FEATURE_ID);
    } catch {
      /* unknown project — skip */
    }
  }
  try {
    fs.unlinkSync(legacyPath);
  } catch {
    /* already gone */
  }
}
