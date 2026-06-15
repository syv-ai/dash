import { app, type BrowserWindow } from 'electron';
import path from 'path';
import * as fs from 'fs';
import { registerWizard, type RequestStartPayload } from '../wizardRegistry';
import type { SpawnOpts } from '../../tui/SidecarTuiHost';
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
import { portsDebug } from '../../services/PortsDebugLog';

const FEATURE_ID = 'ports';

export function registerPortsWizard(): void {
  registerWizard({
    id: FEATURE_ID,
    buildSpawn: (payload, getMainWindow) => onboardingSpawn(payload, getMainWindow),
    isRelevant: (payload) => portsOnboardingRelevant(payload.cwd),
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
    cols: payload.cols,
    rows: payload.rows,
    tabLabel: 'Set up ports?',
    env: { DASH_TUI_PROJECT_NAME: payload.projectName },
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
            cols: payload.cols,
            rows: payload.rows,
            getMainWindow,
          }),
      }),
  };
}

/** Migrate-spawned path: drive the agent's setup run in the new task. */
function setupSpawn(args: {
  taskId: string;
  projectId: string;
  projectName: string;
  cwd: string;
  cols: number;
  rows: number;
  getMainWindow: () => BrowserWindow | null;
}): SpawnOpts {
  return {
    featureId: FEATURE_ID,
    taskId: args.taskId,
    projectId: args.projectId,
    cwd: args.cwd,
    cols: args.cols,
    rows: args.rows,
    tabLabel: 'Set up ports',
    // The user picked "Set it up" — landing them on the setup TUI is the
    // point of the migrate, unlike the unrequested onboarding CTA.
    activate: true,
    env: { DASH_TUI_PROJECT_NAME: args.projectName },
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
  cols: number;
  rows: number;
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
    // A committed setup-complete from a previous run (pre-gitignore repos)
    // would land in the fresh worktree; the agent's step 1 deletes it too,
    // but main owning the reset keeps the DONE trigger trustworthy even if
    // the agent skips instructions.
    fs.rmSync(path.join(dashDir, 'setup-complete'), { force: true });
    WorkspacePortsRuntime.setupTask({ taskId: task.id, worktreePath: task.path });
    ensurePortsConfigWatch(task.id, task.path);
    portsDebug.log('migrate', 'watcher armed', {
      taskId: task.id,
      dashDir,
      exists: fs.existsSync(dashDir),
    });
  } catch (err) {
    portsDebug.log('migrate', 'ports bootstrap failed', { err: String(err) });
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
    portsDebug.log('migrate', 'initial prompt stashed', {
      taskId: task.id,
      promptLen: setupPrompt.length,
    });
  } catch (err) {
    // Best effort — if the builder somehow fails, the setup flow still
    // surfaces the 30-min ports.json timeout, and the user can re-run
    // setup from the Dash UI.
    portsDebug.log('migrate', 'initial-prompt build failed', { err: String(err) });
  }

  // Kick off the spawn synchronously so the host's pending set contains the
  // new task before we notify the renderer — its requestStart effect checks
  // wizard:active (pending ∪ active ∪ suppressed) and bails.
  //
  // Don't await the full spawn before sending the IPC: the side-car PTY +
  // socket dance can take long enough that the user sees the old task's
  // "migrating" spinner stuck for seconds. We still await afterwards so
  // failures surface to the onboarding flow's migrate() caller.
  const spawnPromise = getTuiHost().spawn(
    setupSpawn({
      taskId: task.id,
      projectId: args.currentProjectId,
      projectName: project.name,
      cwd: task.path,
      cols: args.cols,
      rows: args.rows,
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
