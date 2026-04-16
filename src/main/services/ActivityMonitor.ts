import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WebContents } from 'electron';
import type { ActivityState, ActivityInfo, ToolActivity, ActivityError } from '@shared/types';

const execFileAsync = promisify(execFile);

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
  /** Current tool being executed (from PreToolUse hook). */
  tool: ToolActivity | null;
  /** Error info from StopFailure hook. */
  error: ActivityError | null;
  /** Whether context is being compacted. */
  compacting: boolean;
  /** Timestamp when this PTY was registered. Used to suppress idle→busy
   *  self-heal during Claude CLI startup (initialization child processes). */
  registeredAt: number;
  /** Pending busy timer. setBusy defers the actual transition so that
   *  slash commands like /clear (which fire UserPromptSubmit then Stop
   *  almost immediately) don't flash busy. */
  pendingBusyTimer: ReturnType<typeof setTimeout> | null;
}

// PowerShell is heavier than ps, so poll less frequently on Windows
const POLL_INTERVAL = process.platform === 'win32' ? 5000 : 2000;

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

/** How long (ms) after PTY registration before the idle→busy polling
 *  self-heal is allowed. During Claude CLI startup, initialization child
 *  processes (loading CLAUDE.md, indexing, etc.) would falsely trigger
 *  the self-heal. After this window, hooks are the primary signal. */
const STARTUP_GRACE_MS = 15_000;

/** How long (ms) to defer the busy transition after UserPromptSubmit.
 *  Slash commands like /clear fire UserPromptSubmit then Stop almost
 *  immediately — this debounce prevents a visible busy flash. Real
 *  prompts take longer, so the delay is imperceptible. */
const BUSY_DEBOUNCE_MS = 300;

/** Build a human-readable label from a PreToolUse hook payload. */
function buildToolLabel(toolName: string, toolInput: Record<string, unknown> | undefined): string {
  if (!toolInput) return toolName;

  switch (toolName) {
    case 'Bash': {
      const cmd = toolInput.description || toolInput.command;
      if (typeof cmd === 'string') {
        const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
        return short;
      }
      return 'Running command';
    }
    case 'Edit':
    case 'Write':
    case 'Read': {
      const fp = toolInput.file_path;
      if (typeof fp === 'string') {
        const parts = fp.split('/');
        const filename = parts[parts.length - 1];
        const verb = toolName === 'Read' ? 'Reading' : toolName === 'Edit' ? 'Editing' : 'Writing';
        return `${verb} ${filename}`;
      }
      return toolName;
    }
    case 'Grep':
      return typeof toolInput.pattern === 'string'
        ? `Searching for "${toolInput.pattern}"`
        : 'Searching code';
    case 'Glob':
      return typeof toolInput.pattern === 'string'
        ? `Finding ${toolInput.pattern}`
        : 'Finding files';
    case 'Agent':
      return typeof toolInput.description === 'string' ? toolInput.description : 'Running agent';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return typeof toolInput.query === 'string'
        ? `Searching "${toolInput.query}"`
        : 'Searching web';
    default:
      // MCP tools: mcp__server__tool → "server: tool"
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        if (parts.length >= 3) return `${parts[1]}: ${parts.slice(2).join('__')}`;
      }
      return toolName;
  }
}

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
      tool: null,
      error: null,
      compacting: false,
      registeredAt: now,
      pendingBusyTimer: null,
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
   * Refreshes timestamps so the polling fallback doesn't falsely transition
   * busy→idle while Claude is working (statusLine fires during active work).
   *
   * Does NOT transition idle→busy — that is handled by setBusy (UserPromptSubmit),
   * setToolStart (PreToolUse), and the polling self-heal. StatusLine can fire
   * during session startup/load before Claude is actually working, which would
   * cause false busy state with no subsequent Stop hook to clear it.
   */
  noteStatusLine(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity) return;
    const now = Date.now();
    activity.lastDataTime = now;
    activity.lastStatusLineTime = now;
    activity.lastChildSeenTime = now;
  }

  /**
   * Immediately transition a PTY to idle.
   * Called by HookServer when a Claude Code Stop hook fires.
   */
  setIdle(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity) return;
    // Cancel any pending busy transition (e.g. from /clear)
    if (activity.pendingBusyTimer) {
      clearTimeout(activity.pendingBusyTimer);
      activity.pendingBusyTimer = null;
    }
    if (activity.state === 'idle') return;
    activity.state = 'idle';
    activity.lastStatusLineTime = 0;
    activity.idleChildrenSince = 0;
    activity.tool = null;
    activity.compacting = false;
    this.emitAll();
  }

  /**
   * Immediately transition a PTY to busy.
   * Called by HookServer when a Claude Code UserPromptSubmit hook fires.
   */
  setBusy(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity || activity.state === 'busy') return;
    // Cancel any existing pending timer before scheduling a new one
    if (activity.pendingBusyTimer) {
      clearTimeout(activity.pendingBusyTimer);
    }
    // Defer the transition so slash commands that fire Stop immediately
    // after UserPromptSubmit don't flash busy in the UI.
    activity.pendingBusyTimer = setTimeout(() => {
      activity.pendingBusyTimer = null;
      if (activity.state === 'busy') return; // Already transitioned by another path
      activity.state = 'busy';
      activity.lastChildSeenTime = Date.now();
      activity.idleChildrenSince = 0;
      activity.error = null;
      this.emitAll();
    }, BUSY_DEBOUNCE_MS);
  }

  /**
   * Immediately transition a PTY to waiting (permission prompt).
   * Called by HookServer when a Notification hook fires with permission_prompt.
   */
  setWaitingForPermission(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity || activity.state === 'waiting') return;
    activity.state = 'waiting';
    activity.tool = null;
    this.emitAll();
  }

  /**
   * Record that a tool started executing (PreToolUse hook).
   * Sets the current tool info and ensures the PTY is in busy state.
   */
  setToolStart(ptyId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const activity = this.activities.get(ptyId);
    if (!activity) return;

    // Tool start is definitive proof of work — cancel any pending debounce
    // and transition to busy immediately.
    if (activity.pendingBusyTimer) {
      clearTimeout(activity.pendingBusyTimer);
      activity.pendingBusyTimer = null;
    }

    activity.tool = {
      toolName,
      label: buildToolLabel(toolName, toolInput),
    };

    // Ensure busy state (covers edge case where UserPromptSubmit was missed)
    if (activity.state !== 'busy') {
      activity.state = 'busy';
      activity.idleChildrenSince = 0;
      activity.error = null;
    }

    const now = Date.now();
    activity.lastDataTime = now;
    activity.lastChildSeenTime = now;
    this.emitAll();
  }

  /**
   * Record that a tool finished executing (PostToolUse hook).
   * Clears the current tool but keeps the PTY busy (Claude is between tools).
   */
  setToolEnd(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity) return;
    activity.tool = null;
    const now = Date.now();
    activity.lastDataTime = now;
    activity.lastChildSeenTime = now;
    this.emitAll();
  }

  /**
   * Record a stop failure (StopFailure hook).
   * Transitions to error state with details about the failure.
   */
  private static readonly ERROR_TYPE_MAP: Record<string, ActivityError['type']> = {
    rate_limit: 'rate_limit',
    authentication_failed: 'auth_error',
    billing_error: 'billing_error',
  };

  setError(ptyId: string, errorType: string, message?: string): void {
    const activity = this.activities.get(ptyId);
    if (!activity) return;

    const mappedType: ActivityError['type'] =
      ActivityMonitorImpl.ERROR_TYPE_MAP[errorType] ?? 'unknown';

    activity.state = 'error';
    activity.tool = null;
    activity.error = { type: mappedType, message };
    this.emitAll();
  }

  /**
   * Set compacting state (PreCompact/PostCompact hooks).
   */
  setCompacting(ptyId: string, compacting: boolean): void {
    const activity = this.activities.get(ptyId);
    if (!activity) return;
    activity.compacting = compacting;
    if (compacting) {
      activity.tool = null; // Clear tool during compaction
    }
    this.emitAll();
  }

  unregister(ptyId: string): void {
    const activity = this.activities.get(ptyId);
    if (activity) {
      if (activity.pendingBusyTimer) clearTimeout(activity.pendingBusyTimer);
      this.activities.delete(ptyId);
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

  getAll(): Record<string, ActivityInfo> {
    const result: Record<string, ActivityInfo> = {};
    for (const [id, activity] of this.activities) {
      // Only expose direct-spawn (Claude CLI) PTYs to the renderer.
      // Shell terminals cycle busy/idle on every command, which would
      // trigger notification sounds and misleading activity indicators.
      if (!activity.isDirectSpawn) continue;
      const info: ActivityInfo = { state: activity.state };
      if (activity.tool) info.tool = activity.tool;
      if (activity.error) info.error = activity.error;
      if (activity.compacting) info.compacting = true;
      result[id] = info;
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
        // chained tool calls). Suppressed during startup grace period
        // to avoid false positives from Claude CLI initialization.
        const pastStartup = Date.now() - activity.registeredAt > STARTUP_GRACE_MS;
        if (activity.state === 'idle' && hasChildren && pastStartup) {
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
        if (
          activity.state === 'busy' ||
          activity.state === 'waiting' ||
          activity.state === 'error'
        ) {
          const now = Date.now();
          const childlessTimeout =
            !hasChildren &&
            now - activity.lastChildSeenTime > DIRECT_SPAWN_CHILDLESS_HARD_LIMIT_MS &&
            now - activity.lastPtyOutputTime > DIRECT_SPAWN_CHILDLESS_HARD_LIMIT_MS;
          if (childlessTimeout) {
            activity.state = 'idle';
            activity.tool = null;
            activity.compacting = false;
            changed = true;
          }
        }
        continue;
      }

      const isWorking = this.hasActiveWork(activity.pid, activity.isDirectSpawn, childMap);
      const newState: ActivityState = isWorking ? 'busy' : 'idle';

      if (activity.state !== newState) {
        activity.state = newState;
        if (!isWorking) {
          activity.tool = null;
        }
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
      let pidPpidPairs: Array<[number, number]> = [];

      if (process.platform === 'win32') {
        // Windows: PowerShell Get-CimInstance returns the same data as ps -eo
        const { stdout } = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation',
          ],
          { timeout: 5000 },
        );
        const lines = stdout.split(/\r?\n/);
        // Skip CSV header
        for (let i = 1; i < lines.length; i++) {
          const match = lines[i].trim().match(/^"?(\d+)"?,"?(\d+)"?$/);
          if (!match) continue;
          pidPpidPairs.push([parseInt(match[1], 10), parseInt(match[2], 10)]);
        }
      } else {
        const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid='], {
          timeout: 2000,
        });
        pidPpidPairs = stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => l.split(/\s+/))
          .filter((parts) => parts.length >= 2)
          .map((parts) => [parseInt(parts[0], 10), parseInt(parts[1], 10)] as [number, number]);
      }

      for (const [pid, ppid] of pidPpidPairs) {
        if (isNaN(pid) || isNaN(ppid)) continue;
        let siblings = map.get(ppid);
        if (!siblings) {
          siblings = [];
          map.set(ppid, siblings);
        }
        siblings.push(pid);
      }
    } catch {
      // ps/powershell failed — return empty map, all PTYs will show idle
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
