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
  /** Timestamp of last actual PTY output (terminal data from node-pty).
   *  Unlike lastDataTime, this is NOT refreshed by statusLine POSTs,
   *  so it accurately reflects when the terminal last produced output. */
  lastPtyOutputTime: number;
  /** Timestamp when child processes were last observed (for direct-spawn PTYs). */
  lastChildSeenTime: number;
  /** Timestamp when children were first continuously observed while idle.
   *  Reset to 0 when no children are detected. Used for delayed idle→busy self-heal. */
  idleChildrenSince: number;
  /** Timestamp of last statusLine update from Claude Code.
   *  StatusLine only fires while Claude is actively working, so a recent
   *  update is strong evidence of busy state even without child processes. */
  lastStatusLineTime: number;
  /** Timestamp when setIdle was last called. Used by noteStatusLine to avoid
   *  transitioning back to busy from delayed/buffered statusLine POSTs. */
  lastIdleTime: number;
}

const POLL_INTERVAL = 2000;

/** Hard safety valve: if no child processes for this long while busy/waiting,
 *  force idle. The primary busy→idle signal is the Stop hook — this only
 *  catches truly stuck states where the hook never fires. Long enough to
 *  avoid false positives during agent execution and thinking phases. */
const DIRECT_SPAWN_CHILDLESS_HARD_LIMIT_MS = 45_000;

/** How long (ms) children must be continuously present while idle before
 *  polling self-heals to busy. Filters out brief startup child processes
 *  (which last < 1s) while recovering from missed busy hooks or mid-response
 *  stop hooks that fired between chained tool calls. */
const IDLE_TO_BUSY_GRACE_MS = 4000;

/** How long (ms) after setIdle before noteStatusLine is allowed to transition
 *  back to busy. Prevents delayed/buffered statusLine POSTs from racing with
 *  the Stop hook. After this window, statusLine acts as a fast busy signal
 *  for cases where the UserPromptSubmit hook missed. */
const IDLE_SETTLE_MS = 2000;

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
      lastPtyOutputTime: now,
      lastChildSeenTime: now,
      idleChildrenSince: 0,
      lastStatusLineTime: 0,
      lastIdleTime: 0,
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
      const now = Date.now();
      activity.lastDataTime = now;
      activity.lastPtyOutputTime = now;
    }
  }

  /**
   * Called when a statusLine update is received from Claude Code.
   * StatusLine only fires while Claude is actively working, so refresh
   * timestamps to prevent the polling fallback from falsely transitioning
   * busy→idle. Also transitions idle→busy if the PTY has been idle for
   * longer than IDLE_SETTLE_MS, providing fast busy detection when the
   * UserPromptSubmit hook misses. The settle window prevents delayed
   * statusLine POSTs from racing with the Stop hook.
   */
  noteStatusLine(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity) return;
    const now = Date.now();
    activity.lastDataTime = now;
    activity.lastStatusLineTime = now;
    activity.lastChildSeenTime = now;
    if (activity.state === 'idle' && now - activity.lastIdleTime > IDLE_SETTLE_MS) {
      activity.state = 'busy';
      activity.idleChildrenSince = 0;
      this.emitAll();
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
    activity.lastIdleTime = Date.now();
    activity.lastStatusLineTime = 0;
    activity.idleChildrenSince = 0;
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
    activity.idleChildrenSince = 0;
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
        if (activity.state === 'waiting' && hasChildren) {
          activity.state = 'busy';
          activity.idleChildrenSince = 0;
          changed = true;
        }

        // Delayed self-heal: idle → busy when children are continuously
        // present for IDLE_TO_BUSY_GRACE_MS. This recovers from missed
        // busy hooks and mid-response stop hooks (which fire between
        // chained tool calls). The grace period filters out brief startup
        // child processes that last < 1s.
        if (activity.state === 'idle' && hasChildren) {
          if (activity.idleChildrenSince === 0) {
            activity.idleChildrenSince = Date.now();
          } else if (Date.now() - activity.idleChildrenSince > IDLE_TO_BUSY_GRACE_MS) {
            activity.state = 'busy';
            activity.idleChildrenSince = 0;
            changed = true;
          }
        }
        if (activity.state === 'idle' && !hasChildren) {
          activity.idleChildrenSince = 0;
        }

        // Safety valve: force idle if no children for a very long time AND
        // no recent PTY output. The primary busy→idle signal is the Stop hook
        // (setIdle). This only catches truly stuck states (e.g. hook never
        // fires due to crash). Process death is handled above via isProcessAlive.
        // During extended thinking, Claude has no child processes but the
        // spinner still emits PTY data — so we check lastPtyOutputTime too
        // (not lastDataTime, which statusLine POSTs also refresh).
        if (activity.state === 'busy' || activity.state === 'waiting') {
          const now = Date.now();
          const childlessTimeout =
            !hasChildren &&
            now - activity.lastChildSeenTime > DIRECT_SPAWN_CHILDLESS_HARD_LIMIT_MS &&
            now - activity.lastPtyOutputTime > DIRECT_SPAWN_CHILDLESS_HARD_LIMIT_MS;
          if (childlessTimeout) {
            activity.state = 'idle';
            changed = true;
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
