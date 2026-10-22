import { EventEmitter } from 'events';
import type { WebContents } from 'electron';
import type { ActivityState, ActivityInfo, ToolActivity, ActivityError } from '@shared/types';
import type { SupervisorActivity } from './supervisorSession';

interface PtyActivity {
  pid: number;
  state: ActivityState;
  /** Timestamp of last actual PTY output byte (from node-pty). Touched by
   *  noteData() in ptyManager. Used by the safety valve. */
  lastPtyOutputTime: number;
  /** Timestamp of the last hook-driven state mutation. Touched by every
   *  state-setting method below. Used by the safety valve. */
  lastHookTime: number;
  /** Timestamp of the last supervisor reconcile that confirmed the state. */
  lastSupervisorTime: number;
  tool: ToolActivity | null;
  error: ActivityError | null;
  compacting: boolean;
  /** Reason shown with `stopped`/`waiting` (from the supervisor listing). */
  detail: string | null;
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

/**
 * Main-side listeners for activity changes (the control API's `tasks.wait`).
 * `'change'` carries the full `getAll()` map after every state change,
 * whether or not a renderer is attached.
 */
export const activityEvents = new EventEmitter();
// Every pending tasks.wait holds one listener.
activityEvents.setMaxListeners(0);

class ActivityMonitorImpl {
  private activities = new Map<string, PtyActivity>();
  private sender: WebContents | null = null;
  private safetyValveTimer: ReturnType<typeof setInterval> | null = null;

  private fresh(pid: number): PtyActivity {
    const now = Date.now();
    return {
      pid,
      state: 'idle',
      lastPtyOutputTime: now,
      lastHookTime: now,
      lastSupervisorTime: 0,
      tool: null,
      error: null,
      compacting: false,
      detail: null,
    };
  }

  register(ptyId: string, pid: number): void {
    this.activities.set(ptyId, this.fresh(pid));
    this.emitAll();
  }

  /**
   * Register only when unknown — keeps state across attach client restarts.
   * No hook has spoken for a fresh entry, so `lastHookTime` starts at 0 and
   * the first supervisor reading applies unconditionally.
   */
  ensure(ptyId: string): void {
    if (this.activities.has(ptyId)) return;
    const a = this.fresh(0);
    a.lastHookTime = 0;
    this.activities.set(ptyId, a);
    this.emitAll();
  }

  has(ptyId: string): boolean {
    return this.activities.has(ptyId);
  }

  /**
   * Fold a supervisor listing row into the task's activity (design doc §6.6).
   * Hooks stay the instant signal: a busy/idle reading from the supervisor
   * is ignored while a hook spoke within the last poll interval, since hooks
   * carry the tool label and land seconds earlier. `waiting`, `error` and
   * `stopped` come only from the supervisor (or the permission hook) and
   * always apply, as does anything that lifts a `stopped`/`error` state.
   * One more asymmetry: for a task whose hooks reach us, the supervisor may
   * take it to idle (a lost Stop hook) but never to busy — its `status` stays
   * `busy` long after a turn has ended, and hooks land first anyway.
   */
  applySupervisor(ptyId: string, activity: SupervisorActivity, pollIntervalMs: number): void {
    let a = this.activities.get(ptyId);
    // A row the listing created is news to the renderer even when its state
    // matches the fresh default (`idle`): without an emit the sidebar shows no
    // dot — and no "Put to sleep" button — for that task until something changes.
    let created = false;
    if (!a) {
      a = this.fresh(0);
      a.lastHookTime = 0;
      this.activities.set(ptyId, a);
      created = true;
    }
    const now = Date.now();
    a.lastSupervisorTime = now;
    const hooksFresh = now - a.lastHookTime < pollIntervalMs;
    const hookDriven = a.state === 'busy' || a.state === 'idle' || a.state === 'waiting';
    const next = activity.state;
    if ((next === 'busy' || next === 'idle') && hooksFresh && hookDriven) return;
    // The listing's `status` goes stale after a turn ends — a session that had
    // been sitting at the prompt for ten minutes still reported `busy`, and a
    // `done` job did so for hours. So for a task whose hooks talk to us
    // (registered, lastHookTime set — entries the listing created carry 0) the
    // supervisor never *promotes* to busy: hooks own that transition. It still
    // drives busy for listing-only tasks, which have no hooks to speak.
    if (next === 'busy' && hookDriven && a.lastHookTime > 0) return;

    const nextError = next === 'error' ? (activity.error ?? a.error) : null;
    const nextDetail = activity.detail ?? null;
    const changed =
      created ||
      a.state !== next ||
      a.detail !== nextDetail ||
      (a.error?.type ?? null) !== (nextError?.type ?? null) ||
      (a.error?.message ?? null) !== (nextError?.message ?? null);
    if (!changed) return;
    a.state = next;
    a.error = nextError;
    a.detail = nextDetail;
    if (next !== 'busy') a.tool = null;
    if (next === 'idle' || next === 'stopped') a.compacting = false;
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
    a.detail = null;
    this.emitAll();
  }

  setBusy(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    if (a.state === 'busy') return;
    a.state = 'busy';
    a.error = null;
    a.detail = null;
    this.emitAll();
  }

  setWaitingForPermission(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    if (a.state === 'waiting') return;
    a.state = 'waiting';
    a.tool = null;
    a.detail = null;
    this.emitAll();
  }

  /**
   * The user pressed Escape in the agent pane. Claude Code treats that as an
   * interrupt while a turn is running or a permission prompt is up, and — by
   * design — does not fire the Stop hook for it, so nothing else brings the
   * dot back from "running". The supervisor listing can't be relied on
   * either: its `status` goes stale (a `done` job has reported `busy` for
   * hours). So the keystroke is the signal, and like a hook it keeps
   * precedence over the listing for one poll interval. Escape while already
   * idle just closes menus; nothing to do.
   */
  setInterrupted(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    if (a.state !== 'busy' && a.state !== 'waiting') return;
    a.lastHookTime = Date.now();
    a.state = 'idle';
    a.tool = null;
    a.compacting = false;
    a.detail = null;
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
      a.detail = null;
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
      if (a.detail) info.detail = a.detail;
      result[id] = info;
    }
    return result;
  }

  private tickSafetyValve(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, a] of this.activities) {
      if (a.state !== 'busy' && a.state !== 'waiting') continue;
      const silentSince = now - Math.max(a.lastHookTime, a.lastPtyOutputTime, a.lastSupervisorTime);
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
    activityEvents.emit('change', all);
  }
}

export const activityMonitor = new ActivityMonitorImpl();
