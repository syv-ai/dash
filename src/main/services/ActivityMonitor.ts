import type { WebContents } from 'electron';
import type { ActivityState, ActivityInfo, ToolActivity, ActivityError } from '@shared/types';

interface PtyActivity {
  pid: number;
  state: ActivityState;
  /** Timestamp of last actual PTY output byte (from node-pty). Touched by
   *  noteData() in ptyManager. Used by the safety valve. */
  lastPtyOutputTime: number;
  /** Timestamp of the last hook-driven state mutation. Touched by every
   *  state-setting method below. Used by the safety valve. */
  lastHookTime: number;
  tool: ToolActivity | null;
  error: ActivityError | null;
  compacting: boolean;
}

/** Safety valve: if a busy/waiting PTY produces no hook events AND no PTY
 *  output for this long, force it to idle. Recovers from Claude crashes /
 *  silent hook failures. Long enough that legitimate long-running silent
 *  tools (test suites with no stdout, etc.) don't trip it. */
const SAFETY_VALVE_MS = 5 * 60_000;
const SAFETY_VALVE_TICK_MS = 30_000;

function buildToolLabel(toolName: string, toolInput: Record<string, unknown> | undefined): string {
  if (!toolInput) return toolName;

  switch (toolName) {
    case 'Bash': {
      const cmd = toolInput.description || toolInput.command;
      if (typeof cmd === 'string') {
        return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
      }
      return 'Running command';
    }
    case 'Edit':
    case 'Write':
    case 'Read': {
      const fp = toolInput.file_path;
      if (typeof fp === 'string') {
        const filename = fp.split('/').pop() ?? fp;
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
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        if (parts.length >= 3) return `${parts[1]}: ${parts.slice(2).join('__')}`;
      }
      return toolName;
  }
}

class ActivityMonitorImpl {
  private activities = new Map<string, PtyActivity>();
  private sender: WebContents | null = null;
  private safetyValveTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(all: Record<string, ActivityInfo>) => void>();

  /**
   * Observe activity-state changes in-process (the LoopScheduler watches its
   * worker PTY for busy→idle transitions). Fires after every emit with the full
   * map, mirroring what the renderer receives. Returns an unsubscribe fn.
   */
  subscribe(cb: (all: Record<string, ActivityInfo>) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  register(ptyId: string, pid: number): void {
    const now = Date.now();
    this.activities.set(ptyId, {
      pid,
      state: 'idle',
      lastPtyOutputTime: now,
      lastHookTime: now,
      tool: null,
      error: null,
      compacting: false,
    });
    this.emitAll();
  }

  unregister(ptyId: string): void {
    if (this.activities.delete(ptyId)) {
      this.emitAll();
    }
  }

  /** Touched on every PTY byte by ptyManager. Used by the safety valve. */
  noteData(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (a) a.lastPtyOutputTime = Date.now();
  }

  setIdle(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    // Stop clears tool and compacting defensively even when already idle —
    // covers the edge case where PreCompact arrived but PostCompact didn't.
    const hadChange = a.state !== 'idle' || a.tool !== null || a.compacting;
    if (!hadChange) return;
    a.state = 'idle';
    a.tool = null;
    a.compacting = false;
    this.emitAll();
  }

  setBusy(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    if (a.state === 'busy') return;
    a.state = 'busy';
    a.error = null;
    this.emitAll();
  }

  setWaitingForPermission(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    if (a.state === 'waiting') return;
    a.state = 'waiting';
    a.tool = null;
    this.emitAll();
  }

  setToolStart(ptyId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    a.tool = { toolName, label: buildToolLabel(toolName, toolInput) };
    if (a.state !== 'busy') {
      a.state = 'busy';
      a.error = null;
    }
    this.emitAll();
  }

  setToolEnd(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    a.tool = null;
    this.emitAll();
  }

  private static readonly ERROR_TYPE_MAP: Record<string, ActivityError['type']> = {
    rate_limit: 'rate_limit',
    authentication_failed: 'auth_error',
    billing_error: 'billing_error',
  };

  setError(ptyId: string, errorType: string, message?: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    const mappedType =
      ActivityMonitorImpl.ERROR_TYPE_MAP[errorType] ?? ('unknown' as ActivityError['type']);
    a.state = 'error';
    a.tool = null;
    a.error = { type: mappedType, message };
    this.emitAll();
  }

  setCompacting(ptyId: string, compacting: boolean): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    a.compacting = compacting;
    if (compacting) a.tool = null;
    this.emitAll();
  }

  start(sender: WebContents): void {
    this.sender = sender;
    if (this.safetyValveTimer) return;
    this.safetyValveTimer = setInterval(() => this.tickSafetyValve(), SAFETY_VALVE_TICK_MS);
  }

  stop(): void {
    if (this.safetyValveTimer) {
      clearInterval(this.safetyValveTimer);
      this.safetyValveTimer = null;
    }
    this.sender = null;
  }

  getAll(): Record<string, ActivityInfo> {
    const result: Record<string, ActivityInfo> = {};
    for (const [id, a] of this.activities) {
      const info: ActivityInfo = { state: a.state };
      if (a.tool) info.tool = a.tool;
      if (a.error) info.error = a.error;
      if (a.compacting) info.compacting = true;
      result[id] = info;
    }
    return result;
  }

  private tickSafetyValve(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, a] of this.activities) {
      if (a.state !== 'busy' && a.state !== 'waiting') continue;
      const silentSince = now - Math.max(a.lastHookTime, a.lastPtyOutputTime);
      if (silentSince > SAFETY_VALVE_MS) {
        console.warn(
          `[ActivityMonitor] safety valve forced idle ptyId=${id} prevState=${a.state} silentMs=${silentSince}`,
        );
        a.state = 'idle';
        a.tool = null;
        a.compacting = false;
        changed = true;
      }
    }
    if (changed) this.emitAll();
  }

  private emitAll(): void {
    const all = this.getAll();
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send('pty:activity', all);
    }
    if (this.listeners.size > 0) {
      for (const cb of this.listeners) {
        try {
          cb(all);
        } catch (err) {
          console.error('[ActivityMonitor] listener threw', err);
        }
      }
    }
  }
}

export const activityMonitor = new ActivityMonitorImpl();
