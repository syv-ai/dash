import { spawn } from 'child_process';
import type { WebContents } from 'electron';
import type { ActivityState, LoopConfig, LoopLevel, LoopStatus } from '@shared/types';
import { LoopScheduler, type LoopDriver } from './LoopScheduler';
import { LoopService } from './LoopService';
import { buildLoopSpawn } from './loopSpawn';
import { DatabaseService } from './DatabaseService';
import { activityMonitor } from './ActivityMonitor';
import { startDirectPty, killPtyAwait, getRecentOutput } from './ptyManager';
import { hookServer } from './HookServer';

/**
 * The scheduler↔PTY adapter (docs/agentic-loops-plan.md item 6). Dash owns the
 * iteration `while`: this is the single place both loop agents are spawned, so
 * the renderer's two panes stay display-only (`managedExternally`) and can never
 * race the controller for the shared worktree.
 *
 * Per running loop it owns one persistent MANAGER PTY (`mgr:<taskId>`, spawned
 * once, never reset) and one ephemeral WORKER PTY (`loop:<taskId>`, reset every
 * Ralph pass by the LoopScheduler via this controller's LoopDriver). Worker
 * busy→idle edges (from the hook server → ActivityMonitor) drive the scheduler's
 * iteration boundary; status is pushed to the renderer as `loop:status`.
 *
 * Injected dependencies (ptyManager / child_process / LoopService / DB /
 * ActivityMonitor) are reached through the module singletons; the scheduler
 * itself stays a pure, unit-tested state machine (LoopScheduler.test.ts).
 */

const workerPtyId = (taskId: string): string => `loop:${taskId}`;
const managerPtyId = (taskId: string): string => `mgr:${taskId}`;

// Loop PTYs spawn before the renderer has fit the panes; these initial dims are
// corrected by the first `pty:resize` once the xterm attaches.
const INITIAL_COLS = 120;
const INITIAL_ROWS = 30;

interface RunningLoop {
  scheduler: LoopScheduler;
  cwd: string;
  level: LoopLevel;
  unsubActivity: () => void;
}

/** What the loop MCP bridge needs to service a manager's tool call. */
export interface LoopContext {
  cwd: string;
  level: LoopLevel;
}

class LoopControllerImpl {
  private loops = new Map<string, RunningLoop>();
  private getWebContents: () => WebContents | null = () => null;

  /**
   * Provide the current main-window webContents. A provider (not a stored
   * reference) so status pushes and worker output survive window recreation —
   * the closure reads the live `mainWindow`.
   */
  setWebContentsProvider(fn: () => WebContents | null): void {
    this.getWebContents = fn;
  }

  isRunning(taskId: string): boolean {
    return this.loops.has(taskId);
  }

  /**
   * Seed the state spine, spawn the persistent manager, then start the scheduler
   * (which spawns worker iteration 1). No-op if the loop is already running.
   */
  async start(taskId: string): Promise<void> {
    if (this.loops.has(taskId)) return;

    const task = DatabaseService.getTask(taskId);
    if (!task) throw new Error(`Loop start: task "${taskId}" not found`);
    if (task.taskKind !== 'loop' || !task.loopConfig) {
      throw new Error(`Loop start: task "${taskId}" is not a loop`);
    }
    const config = task.loopConfig;
    const cwd = task.path;

    // Durable memory lives on disk, re-read fresh each pass — seed before any
    // agent reads it. Idempotent: evolving files (STATE/run-log) are preserved.
    await LoopService.seed(cwd, task.name, config);

    // Manager first: persistent overseer, spawned once and never reset.
    await this.spawnManager(taskId, cwd, config);

    const scheduler = new LoopScheduler(
      taskId,
      config,
      LoopService.workerIterationPrompt(config),
      this.buildDriver(taskId, cwd, config),
    );

    // Advance the loop only on the WORKER's busy→idle edges. The subscription
    // fires on every activity change (incl. the manager's); we forward just the
    // worker's state and let the scheduler's edge/guard logic filter the rest.
    const unsubActivity = activityMonitor.subscribe((all) => {
      const state = all[workerPtyId(taskId)]?.state as ActivityState | undefined;
      if (state) scheduler.notifyWorkerState(state);
    });

    this.loops.set(taskId, { scheduler, cwd, level: config.level, unsubActivity });
    await scheduler.start();
  }

  pause(taskId: string): void {
    this.loops.get(taskId)?.scheduler.pause();
  }

  async resume(taskId: string): Promise<void> {
    await this.loops.get(taskId)?.scheduler.resume();
  }

  /** Stop the scheduler, tear down the manager, and forget the loop. */
  async stop(taskId: string): Promise<void> {
    const loop = this.loops.get(taskId);
    if (!loop) return;
    loop.unsubActivity();
    await loop.scheduler.stop();
    await killPtyAwait(managerPtyId(taskId));
    this.loops.delete(taskId);
  }

  /** Stop every running loop (window close / quit). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.loops.keys()].map((id) => this.stop(id)));
  }

  getStatus(taskId: string): LoopStatus | null {
    return this.loops.get(taskId)?.scheduler.getStatus() ?? null;
  }

  getAllStatuses(): Record<string, LoopStatus> {
    const out: Record<string, LoopStatus> = {};
    for (const [id, loop] of this.loops) out[id] = loop.scheduler.getStatus();
    return out;
  }

  /** cwd + level for a running loop, for the MCP bridge (null if not running). */
  getContext(taskId: string): LoopContext | null {
    const loop = this.loops.get(taskId);
    return loop ? { cwd: loop.cwd, level: loop.level } : null;
  }

  /** Feed cumulative token spend to a loop's scheduler (budget auto-pause). */
  noteTokens(taskId: string, totalTokens: number): void {
    this.loops.get(taskId)?.scheduler.noteTokens(totalTokens);
  }

  // ── internals ──────────────────────────────────────────────

  private async spawnManager(taskId: string, cwd: string, config: LoopConfig): Promise<void> {
    const policy = buildLoopSpawn('manager', config);
    await startDirectPty({
      id: managerPtyId(taskId),
      taskId,
      cwd,
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      freshContext: true,
      permissionMode: policy.permissionMode,
      initialPrompt: policy.initialPrompt,
      model: policy.model,
      extraSettings: policy.extraSettings,
      // The loop MCP bridge, attached to the MANAGER only (per-process flag; the
      // worker never gets it). Trusted automatically because it's passed at launch
      // — no approval prompt. Baked with the live hook-server port at spawn time.
      mcpConfig: managerMcpConfig(taskId),
      sender: this.getWebContents() ?? undefined,
    });
  }

  private buildDriver(taskId: string, cwd: string, config: LoopConfig): LoopDriver {
    const wid = workerPtyId(taskId);
    return {
      spawnWorker: async (_iteration, prompt) => {
        const policy = buildLoopSpawn('worker', config);
        await startDirectPty({
          id: wid,
          taskId,
          cwd,
          cols: INITIAL_COLS,
          rows: INITIAL_ROWS,
          freshContext: true,
          initialPrompt: prompt,
          permissionMode: policy.permissionMode,
          model: policy.model,
          extraSettings: policy.extraSettings,
          sender: this.getWebContents() ?? undefined,
        });
      },
      killWorker: async () => {
        await killPtyAwait(wid);
      },
      runShellCheck: (command) => runShellCheck(command, cwd),
      workerOutputContains: (needle) => getRecentOutput(wid).includes(needle),
      emitStatus: (status) => this.emitStatus(status),
      appendRunLog: (entry) => LoopService.appendRunLog(cwd, entry),
      now: () => Date.now(),
      setTimer: (ms, cb) => {
        const t = setTimeout(cb, ms);
        return () => clearTimeout(t);
      },
    };
  }

  private emitStatus(status: LoopStatus): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) wc.send('loop:status', status);
  }
}

/** MCP server name the manager sees its loop tools under (`mcp__dash-loop__*`). */
export const LOOP_MCP_SERVER_NAME = 'dash-loop';

/**
 * The `--mcp-config` JSON string attaching the loop MCP server to the manager.
 * Stateless streamable-HTTP on the hook server, keyed by taskId. The port is
 * read live so a stale value can't outlive a hook-server rebind.
 */
function managerMcpConfig(taskId: string): string {
  const url = `http://127.0.0.1:${hookServer.port}/mcp/loop?taskId=${encodeURIComponent(taskId)}`;
  return JSON.stringify({
    mcpServers: { [LOOP_MCP_SERVER_NAME]: { type: 'http', url } },
  });
}

/**
 * Run a stop-predicate command in the worktree. Resolves true on exit 0 ("done").
 * `shell: true` so a full command line (e.g. `pnpm test && pnpm lint`) works.
 */
function runShellCheck(command: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'ignore' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export const loopController = new LoopControllerImpl();
