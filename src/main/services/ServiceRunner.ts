import path from 'path';
import type { TaskPort, PortLiveness } from '@shared/types';
import { portsDebug } from './PortsDebugLog';

export interface RunnerDeps {
  getTaskPath(taskId: string): string | undefined;
  getPorts(taskId: string): TaskPort[];
  /**
   * Allocated `ENV_VAR=port` pairs for the task. MUST be passed into every
   * service spawn — startCommandPty does NOT inject ports env on its own
   * (only the agent/shell spawn paths do), and those paths key off the
   * worktree root, which would also miss services running in a `cwd` subdir.
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

export function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  /** `${taskId}:${label}` → run-tab id. Logs tabs are never recorded here. */
  private owned = new Map<string, string>();

  constructor(private readonly deps: RunnerDeps) {}

  private key(taskId: string, label: string): string {
    return `${taskId}:${label}`;
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
    portsDebug.log('service', 'start', { taskId, label: port.label, cmd: port.runCommand });
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
      await this.deps.startPty({
        id: tab.id,
        command: this.deps.shell,
        args: ['-lc', port.runCommand],
        cwd: port.cwd ? path.join(taskPath, port.cwd) : taskPath,
        cols: 120,
        rows: 30,
        env: this.deps.portEnv(taskId),
        owner: null,
        taskId,
        featureId: 'ports',
        kind: 'service',
        // A service dying on its own is a status change the panel must hear
        // about — start/stop notify explicitly, this covers self-death.
        onExit: () => this.handleSelfExit(taskId, port.label, tab.id),
      });
      this.owned.set(this.key(taskId, port.label), tab.id);
      this.deps.notifyChanged(taskId);
      return { ok: true };
    } catch (err) {
      const message = `Couldn't start ${port.label}: ${err instanceof Error ? err.message : String(err)}`;
      portsDebug.log('service', 'start failed', { taskId, label: port.label, err: String(err) });
      this.deps.toast(message);
      return { ok: false, message };
    }
  }

  private handleSelfExit(taskId: string, label: string, tabId: string): void {
    if (this.owned.get(this.key(taskId, label)) !== tabId) return;
    portsDebug.log('service', 'self-exit', { taskId, label });
    this.owned.delete(this.key(taskId, label));
    this.deps.notifyChanged(taskId);
  }

  async stop(taskId: string, port: TaskPort): Promise<OpResult> {
    // 1. Dash-owned and alive → kill our PTY.
    const ownedTab = this.ownedTabId(taskId, port.label);
    if (ownedTab) {
      portsDebug.log('service', 'stop: kill owned pty', { taskId, label: port.label });
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
      portsDebug.log('service', 'stop: exec', { taskId, label: port.label, cmd: port.stopCommand });
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
    portsDebug.log('service', 'stop: sigterm pids', { taskId, label: port.label, pids });
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
      await this.deps.startPty({
        id: tab.id,
        command: this.deps.shell,
        args: ['-lc', port.logsCommand],
        cwd: port.cwd ? path.join(taskPath, port.cwd) : taskPath,
        cols: 120,
        rows: 30,
        env: this.deps.portEnv(taskId),
        owner: null,
        taskId,
        featureId: 'ports',
        kind: 'service',
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
