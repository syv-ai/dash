import path from 'path';
import { slugify as slug, type PortLiveness, type TaskPort } from './types';

export interface RunnerDeps {
  getTaskPath(taskId: string): string | undefined;
  getPorts(taskId: string): TaskPort[];
  /**
   * Allocated `ENV_VAR=port` pairs for the task. Passed to every service
   * terminal explicitly: a service may run in a `cwd` subdir, which the
   * worktree-keyed session env would miss.
   */
  portEnv(taskId: string): Record<string, string>;
  /** ctx.terminals.run: (re)spawn a command as a drawer tab keyed by `key`, focus it. */
  runTerminal(
    taskId: string,
    opts: {
      key: string;
      label: string;
      command: string;
      cwd?: string;
      env: Record<string, string>;
      /** Fires only on self-death — explicit stops never reach it. */
      onExit?: () => void;
      /** The user closed the tab. */
      onClosed?: () => void;
    },
  ): Promise<unknown>;
  stopTerminal(taskId: string, key: string): void;
  terminalRunning(taskId: string, key: string): boolean;
  focusTerminal(taskId: string, key: string): void;
  /** Run a short-lived command via the user's shell; resolves with exit code + stderr tail. */
  exec(command: string, cwd: string): Promise<{ code: number; stderrTail: string }>;
  lsofPids(port: number): Promise<number[]>;
  killPid(pid: number): void;
  liveness(taskId: string, hostPort: number): PortLiveness;
  notifyChanged(taskId: string): void;
  toast(message: string): void;
  sleep(ms: number): Promise<void>;
}

export interface OpResult {
  ok: boolean;
  message?: string;
}

const STAGGER_MS = 300;

/**
 * Executes the agent-recorded service commands from .dash/ports.json.
 * Mechanism-agnostic by design: the commands ARE the abstraction — Dash never
 * knows whether a service is compose, a package script, or a bespoke runner.
 * Ownership = "Dash started this service's run terminal and it is still
 * alive"; everything else is external.
 */
export class ServiceRunner {
  /** `${taskId}:${slug(label)}` for services whose run terminal Dash started.
   *  Keyed by the slug, like the terminal key: two labels that slug-collide
   *  (`"My App"` / `"my-app"`) share one terminal and so one ownership entry. */
  private owned = new Set<string>();

  constructor(private readonly deps: RunnerDeps) {}

  private ownKey(taskId: string, label: string): string {
    return `${taskId}:${slug(label)}`;
  }

  /** Dash-owned and its terminal still alive. */
  isOwned(taskId: string, label: string): boolean {
    if (!this.owned.has(this.ownKey(taskId, label))) return false;
    return this.deps.terminalRunning(taskId, slug(label));
  }

  private cwdFor(port: TaskPort): string | undefined {
    return port.cwd ?? undefined;
  }

  async start(taskId: string, port: TaskPort): Promise<OpResult> {
    if (!port.runCommand) return { ok: false, message: `${port.label} has no run command` };
    const key = slug(port.label);
    const own = this.ownKey(taskId, port.label);
    try {
      await this.deps.runTerminal(taskId, {
        key,
        label: port.label,
        command: port.runCommand,
        cwd: this.cwdFor(port),
        env: this.deps.portEnv(taskId),
        // A service dying on its own is a status change the drawer must hear about.
        onExit: () => this.release(taskId, own),
        onClosed: () => this.release(taskId, own),
      });
      this.owned.add(own);
      this.deps.notifyChanged(taskId);
      return { ok: true };
    } catch (err) {
      const message = `Couldn't start ${port.label}: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[ports.ServiceRunner] start failed', taskId, port.label, err);
      this.deps.toast(message);
      return { ok: false, message };
    }
  }

  private release(taskId: string, own: string): void {
    if (!this.owned.delete(own)) return;
    this.deps.notifyChanged(taskId);
  }

  async stop(taskId: string, port: TaskPort): Promise<OpResult> {
    // 1. Dash-owned and alive → stop our terminal.
    if (this.isOwned(taskId, port.label)) {
      this.deps.stopTerminal(taskId, slug(port.label));
      this.owned.delete(this.ownKey(taskId, port.label));
      this.deps.notifyChanged(taskId);
      return { ok: true };
    }
    // 2. Agent-recorded stop command. A failure does NOT fall through to a PID
    //    kill — a broken stop command is a signal to fix, not bypass.
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
    // 3. Last resort: SIGTERM whatever listens on the port. Right for plain
    //    processes, useless for container-published ports.
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
    if (this.isOwned(taskId, port.label)) {
      this.deps.focusTerminal(taskId, slug(port.label));
      return { ok: true };
    }
    if (!port.logsCommand) return { ok: false, message: `${port.label} has no logs command` };
    try {
      // Logs terminals are not ownership: closing one just ends the tail.
      await this.deps.runTerminal(taskId, {
        key: `${slug(port.label)}:logs`,
        label: `${port.label} logs`,
        command: port.logsCommand,
        cwd: this.cwdFor(port),
        env: this.deps.portEnv(taskId),
      });
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
    if (failed.length > 0) this.deps.toast(`Run all: failed to start ${failed.join(', ')}`);
    return { started, failed };
  }

  async stopAll(taskId: string): Promise<{ stopped: string[]; failed: string[] }> {
    const stopped: string[] = [];
    const failed: string[] = [];
    for (const p of this.deps.getPorts(taskId)) {
      // Only running services — Dash-owned or listening — so stop-all stays a
      // no-op on idle ones rather than firing stray stop commands or SIGTERMs.
      const running =
        this.isOwned(taskId, p.label) || this.deps.liveness(taskId, p.hostPort) === 'up';
      if (!running) continue;
      const r = await this.stop(taskId, p);
      (r.ok ? stopped : failed).push(p.label);
    }
    if (failed.length > 0) this.deps.toast(`Stop all: failed to stop ${failed.join(', ')}`);
    return { stopped, failed };
  }

  /** Forget a task (deleted): stop its owned terminals. */
  forgetTask(taskId: string): void {
    for (const own of [...this.owned]) {
      if (!own.startsWith(`${taskId}:`)) continue;
      this.owned.delete(own);
      this.deps.stopTerminal(taskId, own.slice(taskId.length + 1));
    }
  }
}
