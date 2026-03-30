import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WebContents } from 'electron';

const execFileAsync = promisify(execFile);

type ActivityState = 'busy' | 'idle' | 'waiting';

interface PtyActivity {
  pid: number;
  state: ActivityState;
  isDirectSpawn: boolean;
  lastDataTime: number;
  /** Timestamp when child processes were last observed (for direct-spawn PTYs). */
  lastChildSeenTime: number;
}

const POLL_INTERVAL = 2000;

/** How long (ms) a direct-spawn PTY must have no children AND no PTY data
 *  before the polling fallback transitions it to idle. This covers the case
 *  where the Stop hook doesn't fire (e.g. interrupted mid-response) without
 *  falsely marking "thinking" responses (data flowing, no children) as idle. */
const DIRECT_SPAWN_IDLE_GRACE_MS = 6000;

/** Hard safety valve: if no child processes for this long while busy/waiting,
 *  force idle regardless of PTY data. Handles the case where Claude Code's
 *  statusline keeps emitting escape sequences, preventing the data-silence
 *  check from ever triggering. Long enough to avoid false positives during
 *  normal "thinking" phases (API calls with no child processes). */
const DIRECT_SPAWN_CHILDLESS_HARD_LIMIT_MS = 45_000;

class ActivityMonitorImpl {
  private activities = new Map<string, PtyActivity>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private sender: WebContents | null = null;

  register(ptyId: string, pid: number, isDirectSpawn: boolean): void {
    const now = Date.now();
    this.activities.set(ptyId, {
      pid,
      state: 'idle',
      isDirectSpawn,
      lastDataTime: now,
      lastChildSeenTime: now,
    });
    this.emitAll();
  }

  /**
   * Record that PTY data was received. Used by the polling fallback to
   * distinguish "Claude is thinking" (data flowing) from "interrupted"
   * (no data, no children).
   */
  noteData(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (activity) {
      activity.lastDataTime = Date.now();
    }
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
    activity.lastChildSeenTime = Date.now();
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

      // Direct-spawn PTYs are primarily driven by Claude Code hooks.
      // Polling provides fallback transitions for when hooks miss.
      if (activity.isDirectSpawn) {
        const hasChildren = this.hasActiveWork(activity.pid, true, childMap);

        if (hasChildren) {
          activity.lastChildSeenTime = Date.now();
        }

        // Self-heal: if children are detected while waiting for permission,
        // the user approved and Claude started a tool. Transition to busy.
        // Note: we intentionally don't self-heal idle → busy here because
        // Claude CLI briefly spawns children during startup, which would
        // cause a false busy flash on every reopen.
        if (activity.state === 'waiting' && hasChildren) {
          activity.state = 'busy';
          changed = true;
        }

        // Fallback busy/waiting → idle when hooks miss (e.g. interrupted
        // mid-response). Two checks:
        // 1. Data silence: no children AND no PTY data for 6s
        // 2. Hard timeout: no children for 45s (handles statusline
        //    escape sequences that keep lastDataTime refreshed)
        if (activity.state === 'busy' || activity.state === 'waiting') {
          if (!hasChildren) {
            const dataSilent = Date.now() - activity.lastDataTime > DIRECT_SPAWN_IDLE_GRACE_MS;
            const childlessTimeout =
              Date.now() - activity.lastChildSeenTime > DIRECT_SPAWN_CHILDLESS_HARD_LIMIT_MS;
            if (dataSilent || childlessTimeout) {
              activity.state = 'idle';
              changed = true;
            }
          }
        }
        continue;
      }

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
