import path from 'path';
import type { TaskPort, PortLiveness } from '@shared/types';
// Service tab ids derive from the label via the shared slugifier (50-char cap is
// inconsequential for short port labels and keeps tabId/ownership in lockstep).
import { slugify as slug } from '@shared/slug';

export interface RunnerDeps {
  getTaskPath(taskId: string): string | undefined;
  getPorts(taskId: string): TaskPort[];
  /**
   * Allocated `ENV_VAR=port` pairs for the task. Injected by the single
   * spawnServicePty() path so no call site can spawn a service without it —
   * startCommandPty does NOT inject ports env for service spawns (its
   * agent/shell injection keys off the worktree root, which would miss
   * services running in a `cwd` subdir).
   */
  portEnv(taskId: string): Record<string, string>;
  /**
   * Drop the persisted terminal snapshot for a tab id. Service tabs reuse
   * deterministic ids, and closing a tab saves its output as the snapshot —
   * without clearing it, a fresh run replays the previous run's output.
   */
  clearSnapshot(tabId: string): void;
  drawerTabsAdd(
    taskId: string,
    opts: { kind: 'service'; label: string; featureId: 'ports'; id: string },
  ): { id: string };
  /** Close a drawer tab if it exists (DrawerTabsService.close is a no-op for missing ids). */
  drawerTabsCloseIfExists(tabId: string): void;
  startPty(opts: {
    id: string;
    command: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
    owner: unknown;
    taskId: string;
    featureId: string;
    kind: 'service';
    /** Fires only on self-death — explicit kills never reach it (see startCommandPty). */
    onExit?: () => void;
  }): Promise<unknown>;
  killPty(id: string): void;
  ptyAlive(id: string): boolean;
  /** Run a short-lived command via the user's shell; resolves with exit code + stderr tail. */
  exec(command: string, cwd: string): Promise<{ code: number; stderrTail: string }>;
  lsofPids(port: number): Promise<number[]>;
  killPid(pid: number): void;
  liveness(taskId: string, hostPort: number): PortLiveness;
  notifyChanged(taskId: string): void;
  toast(message: string): void;
  focusTab(taskId: string, tabId: string): void;
  shell: string;
  sleep(ms: number): Promise<void>;
}

export interface OpResult {
  ok: boolean;
  message?: string;
}

const STAGGER_MS = 300;

/**
 * Executes the agent-recorded service commands from .dash/ports.json.
 * Mechanism-agnostic by design: the commands ARE the abstraction (see the
 * 2026-06-11 service-runner spec) — Dash never knows whether a service is
 * compose, a package script, or a bespoke runner. Ownership = "Dash spawned
 * this service's run tab and its PTY is still alive"; everything else is
 * external.
 */
export class ServiceRunner {
  /** `${taskId}:${slug(label)}` → run-tab id. Logs tabs are never recorded here.
   *  Keyed by the SLUG, not the raw label, so the ownership key matches the
   *  slug-derived tabId: two labels that slug-collide (`"My App"` / `"my-app"`)
   *  share one tab/PTY and must therefore share one ownership entry, or
   *  start/stop/status/logs cross-wire. */
  private owned = new Map<string, string>();

  constructor(private readonly deps: RunnerDeps) {}

  private key(taskId: string, label: string): string {
    return `${taskId}:${slug(label)}`;
  }

  private ownedTabId(taskId: string, label: string): string | null {
    const tabId = this.owned.get(this.key(taskId, label));
    if (!tabId) return null;
    if (!this.deps.ptyAlive(tabId)) return null;
    return tabId;
  }

  status(taskId: string): Record<string, { ownedTabId: string | null }> {
    const out: Record<string, { ownedTabId: string | null }> = {};
    for (const p of this.deps.getPorts(taskId)) {
      out[p.label] = { ownedTabId: this.ownedTabId(taskId, p.label) };
    }
    return out;
  }

  /**
   * The ONE service-PTY spawn path. Injects the task's allocated port env and
   * the fixed service-tab fields (shell, kind, owner) in a single place, so a
   * service can never be spawned without its ports — see RunnerDeps.portEnv.
   */
  private spawnServicePty(
    taskId: string,
    opts: { id: string; cwd: string; shellCommand: string; onExit?: () => void },
  ): Promise<unknown> {
    return this.deps.startPty({
      id: opts.id,
      command: this.deps.shell,
      args: ['-lc', opts.shellCommand],
      cwd: opts.cwd,
      cols: 120,
      rows: 30,
      env: this.deps.portEnv(taskId),
      owner: null,
      taskId,
      featureId: 'ports',
      kind: 'service',
      onExit: opts.onExit,
    });
  }

  async start(taskId: string, port: TaskPort): Promise<OpResult> {
    if (!port.runCommand) return { ok: false, message: `${port.label} has no run command` };
    const taskPath = this.deps.getTaskPath(taskId);
    if (!taskPath) return { ok: false, message: `task ${taskId} not found` };

    const tabId = `service:${taskId}:${slug(port.label)}`;
    // Respawn into the same tab: kill the previous PTY if one is still around.
    if (this.owned.get(this.key(taskId, port.label))) {
      try {
        this.deps.killPty(tabId);
      } catch {
        /* already gone */
      }
    }
    try {
      // The tab row may still exist from a previous run (respawn into the same
      // id would hit the PK) — close it first; close() is a no-op when absent.
      this.deps.drawerTabsCloseIfExists(tabId);
      this.deps.clearSnapshot(tabId);
      const tab = this.deps.drawerTabsAdd(taskId, {
        kind: 'service',
        label: port.label,
        featureId: 'ports',
        id: tabId,
      });
      await this.spawnServicePty(taskId, {
        id: tab.id,
        cwd: port.cwd ? path.join(taskPath, port.cwd) : taskPath,
        shellCommand: port.runCommand,
        // A service dying on its own is a status change the panel must hear
        // about — start/stop notify explicitly, this covers self-death.
        onExit: () => this.handleSelfExit(taskId, port.label, tab.id),
      });
      this.owned.set(this.key(taskId, port.label), tab.id);
      this.deps.notifyChanged(taskId);
      return { ok: true };
    } catch (err) {
      const message = `Couldn't start ${port.label}: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[ServiceRunner] start failed', taskId, port.label, err);
      this.deps.toast(message);
      return { ok: false, message };
    }
  }

  private handleSelfExit(taskId: string, label: string, tabId: string): void {
    if (this.owned.get(this.key(taskId, label)) !== tabId) return;
    this.owned.delete(this.key(taskId, label));
    this.deps.notifyChanged(taskId);
  }

  async stop(taskId: string, port: TaskPort): Promise<OpResult> {
    // 1. Dash-owned and alive → kill our PTY.
    const ownedTab = this.ownedTabId(taskId, port.label);
    if (ownedTab) {
      this.deps.killPty(ownedTab);
      this.owned.delete(this.key(taskId, port.label));
      this.deps.notifyChanged(taskId);
      return { ok: true };
    }
    // 2. Agent-recorded stop command. A failure does NOT fall through to a
    //    PID kill — the agent said this is the right way to stop it; a broken
    //    stop command is a signal to fix, not bypass.
    if (port.stopCommand) {
      const taskPath = this.deps.getTaskPath(taskId);
      if (!taskPath) return { ok: false, message: `task ${taskId} not found` };
      const cwd = port.cwd ? path.join(taskPath, port.cwd) : taskPath;
      const { code, stderrTail } = await this.deps.exec(port.stopCommand, cwd);
      if (code !== 0) {
        const message = `Stop command for ${port.label} exited ${code}${stderrTail ? `: ${stderrTail}` : ''}`;
        this.deps.toast(message);
        return { ok: false, message };
      }
      return { ok: true };
    }
    // 3. Last resort: SIGTERM whatever listens on the port. Best-effort —
    //    correct for plain processes, useless for container-published ports
    //    (the agent's stop command is the right path for those).
    const pids = await this.deps.lsofPids(port.hostPort);
    if (pids.length === 0) {
      const message = `Nothing listening on :${port.hostPort}`;
      this.deps.toast(message);
      return { ok: false, message };
    }
    for (const pid of pids) this.deps.killPid(pid);
    this.deps.toast(
      `Sent SIGTERM to ${pids.map((p) => `PID ${p}`).join(', ')} (:${port.hostPort})`,
    );
    return { ok: true };
  }

  async logs(taskId: string, port: TaskPort): Promise<OpResult> {
    const ownedTab = this.ownedTabId(taskId, port.label);
    if (ownedTab) {
      this.deps.focusTab(taskId, ownedTab);
      return { ok: true };
    }
    if (!port.logsCommand) return { ok: false, message: `${port.label} has no logs command` };
    const taskPath = this.deps.getTaskPath(taskId);
    if (!taskPath) return { ok: false, message: `task ${taskId} not found` };
    const tabId = `service:${taskId}:${slug(port.label)}:logs`;
    try {
      // Logs tabs are NOT ownership — closing one just kills the tail.
      if (this.deps.ptyAlive(tabId)) this.deps.killPty(tabId);
      this.deps.drawerTabsCloseIfExists(tabId);
      this.deps.clearSnapshot(tabId);
      const tab = this.deps.drawerTabsAdd(taskId, {
        kind: 'service',
        label: `${port.label} logs`,
        featureId: 'ports',
        id: tabId,
      });
      await this.spawnServicePty(taskId, {
        id: tab.id,
        cwd: port.cwd ? path.join(taskPath, port.cwd) : taskPath,
        shellCommand: port.logsCommand,
      });
      this.deps.focusTab(taskId, tab.id);
      return { ok: true };
    } catch (err) {
      const message = `Couldn't open logs for ${port.label}: ${err instanceof Error ? err.message : String(err)}`;
      this.deps.toast(message);
      return { ok: false, message };
    }
  }

  async startAll(taskId: string): Promise<{ started: string[]; failed: string[] }> {
    const started: string[] = [];
    const failed: string[] = [];
    let first = true;
    for (const p of this.deps.getPorts(taskId)) {
      if (!p.runCommand) continue;
      if (this.deps.liveness(taskId, p.hostPort) === 'up') continue;
      // Stagger spawns so a fleet of dev servers doesn't thunder at once.
      if (!first) await this.deps.sleep(STAGGER_MS);
      first = false;
      const r = await this.start(taskId, p);
      (r.ok ? started : failed).push(p.label);
    }
    if (failed.length > 0) {
      this.deps.toast(`Run all: failed to start ${failed.join(', ')}`);
    }
    return { started, failed };
  }
}
