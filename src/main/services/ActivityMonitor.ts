import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WebContents } from 'electron';

const execFileAsync = promisify(execFile);

type ActivityState = 'busy' | 'idle' | 'waiting';

interface PtyActivity {
  pid: number;
  state: ActivityState;
  isDirectSpawn: boolean;
}

const POLL_INTERVAL = 2000;

class ActivityMonitorImpl {
  private activities = new Map<string, PtyActivity>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private sender: WebContents | null = null;

  register(ptyId: string, pid: number, isDirectSpawn: boolean): void {
    this.activities.set(ptyId, {
      pid,
      state: 'idle',
      isDirectSpawn,
    });
    this.emitAll();
  }

  /**
   * Immediately transition a PTY to idle.
   * Called by HookServer when a Claude Code Stop hook fires.
   */
  setIdle(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity || activity.state === 'idle') return;
    activity.state = 'idle';
    this.emitAll();
  }

  /**
   * Immediately transition a PTY to busy.
   * Called by HookServer when a Claude Code UserPromptSubmit hook fires.
   */
  setBusy(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity || activity.state === 'busy') return;
    activity.state = 'busy';
    this.emitAll();
  }

  /**
   * Immediately transition a PTY to waiting (permission prompt).
   * Called by HookServer when a Notification hook fires with permission_prompt.
   */
  setWaitingForPermission(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity || activity.state === 'waiting') return;
    activity.state = 'waiting';
    this.emitAll();
  }

  unregister(ptyId: string): void {
    if (this.activities.delete(ptyId)) {
      this.emitAll();
    }
  }

  start(sender: WebContents): void {
    this.sender = sender;
    this.schedulePoll();
  }

  stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.sender = null;
  }

  getAll(): Record<string, ActivityState> {
    const result: Record<string, ActivityState> = {};
    for (const [id, activity] of this.activities) {
      // Only expose direct-spawn (Claude CLI) PTYs to the renderer.
      // Shell terminals cycle busy/idle on every command, which would
      // trigger notification sounds and misleading activity indicators.
      if (!activity.isDirectSpawn) continue;
      result[id] = activity.state;
    }
    return result;
  }

  private schedulePoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.poll();
      if (this.sender) {
        this.schedulePoll();
      }
    }, POLL_INTERVAL);
  }

  private async poll(): Promise<void> {
    if (this.activities.size === 0) return;

    const childMap = await this.buildChildMap();
    let changed = false;

    for (const [id, activity] of this.activities) {
      if (!this.isProcessAlive(activity.pid)) {
        this.activities.delete(id);
        changed = true;
        continue;
      }

      // Direct-spawn PTYs are driven by Claude Code hooks, not polling
      if (activity.isDirectSpawn) continue;

      const isWorking = this.hasActiveWork(activity.pid, activity.isDirectSpawn, childMap);
      const newState: ActivityState = isWorking ? 'busy' : 'idle';

      if (activity.state !== newState) {
        activity.state = newState;
        changed = true;
      }
    }

    if (changed) {
      this.emitAll();
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e: unknown) {
      // EPERM = process exists but we can't signal it — still alive
      if (e && typeof e === 'object' && 'code' in e && e.code === 'EPERM') {
        return true;
      }
      return false;
    }
  }

  /**
   * Direct spawn: PID is Claude CLI. Children = tool subprocesses = busy.
   * Shell spawn: PID is the shell. Claude is always a child, so check one
   * level deeper — whether Claude has its own children (tool subprocesses).
   */
  private hasActiveWork(
    pid: number,
    isDirectSpawn: boolean,
    childMap: Map<number, number[]>,
  ): boolean {
    const children = childMap.get(pid) || [];

    if (isDirectSpawn) {
      return children.length > 0;
    }

    for (const childPid of children) {
      const grandchildren = childMap.get(childPid) || [];
      if (grandchildren.length > 0) return true;
    }
    return false;
  }

  /**
   * Single `ps` call to build a parent→children map for the whole system.
   * Replaces per-PID `pgrep -P` which is unreliable on macOS.
   */
  private async buildChildMap(): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    try {
      const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid='], {
        timeout: 2000,
      });
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const pid = parseInt(parts[0], 10);
        const ppid = parseInt(parts[1], 10);
        if (isNaN(pid) || isNaN(ppid)) continue;
        let siblings = map.get(ppid);
        if (!siblings) {
          siblings = [];
          map.set(ppid, siblings);
        }
        siblings.push(pid);
      }
    } catch {
      // ps failed — return empty map, all PTYs will show idle
    }
    return map;
  }

  private emitAll(): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('pty:activity', this.getAll());
    }
  }
}

export const activityMonitor = new ActivityMonitorImpl();
