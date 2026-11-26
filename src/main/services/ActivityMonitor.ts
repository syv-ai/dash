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
  /** The turn ended by the user's interrupt; reported while idle, cleared
   *  when the user starts the next turn. */
  interrupted: boolean;
  /** The main agent's own turn is running (a prompt or a main tool call,
   *  until Stop or an interrupt). `busy` can also mean subagents only. */
  mainTurn: boolean;
  /** Background subagents in flight (S3): ids from SubagentStart, minus
   *  SubagentStop, corrected by the running list Stop/SubagentStop carry.
   *  While any run, the task stays busy after the main turn ends. */
  subagents: Set<string>;
  /** Last hook from inside a subagent (start, stop, its tool calls). */
  lastSubagentTime: number;
  /** A pending turn end (TURN_SETTLE_MS), or null. */
  settle: ReturnType<typeof setTimeout> | null;
}

/** How long a turn's end waits before the task shows idle. A finished
 *  background subagent wakes Claude with its report 35–65 ms after its
 *  SubagentStop, and a queued report right after a Stop: without the wait,
 *  each would flash idle (a chime, a blue dot) between two busy spells. */
export const TURN_SETTLE_MS = 1000;

/** The supervisor listing may end in-flight subagents (a missed
 *  SubagentStop) only once none has spoken for this long. */
export const SUBAGENT_QUIET_MS = 5 * 60_000;

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

/** What a task parked on its subagents is doing, for the tool label. */
function subagentsLabel(a: PtyActivity): ToolActivity | null {
  if (a.state !== 'busy' || a.mainTurn || a.subagents.size === 0) return null;
  const n = a.subagents.size;
  return { toolName: 'Agent', label: n === 1 ? '1 subagent running' : `${n} subagents running` };
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
      interrupted: false,
      mainTurn: false,
      subagents: new Set(),
      lastSubagentTime: 0,
      settle: null,
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
    // Hooks own a task's subagents: the listing's idle may end them only
    // once they've gone quiet (a SubagentStop we never got).
    if (next === 'idle' && a.subagents.size > 0 && now - a.lastSubagentTime < SUBAGENT_QUIET_MS)
      return;
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
    this.cancelSettle(a);
    // A waiting reading can be a subagent's permission prompt: they run on.
    if (next !== 'busy' && next !== 'waiting') this.endWork(a);
    a.state = next;
    a.error = nextError;
    a.detail = nextDetail;
    if (next !== 'idle') a.interrupted = false;
    if (next !== 'busy') a.tool = null;
    if (next === 'idle' || next === 'stopped') a.compacting = false;
    this.emitAll();
  }

  unregister(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    this.cancelSettle(a);
    this.activities.delete(ptyId);
    this.emitAll();
  }

  /** Touched on every PTY byte by ptyManager. Used by the safety valve. */
  noteData(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (a) a.lastPtyOutputTime = Date.now();
  }

  /**
   * Idle now, subagents and all: the session ended, or Claude Code says it
   * has sat at the prompt with nothing in the background (idle_prompt). A
   * turn's own end goes through endTurn.
   */
  setIdle(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    this.cancelSettle(a);
    this.endWork(a);
    // Clears tool and compacting defensively even when already idle —
    // covers the edge case where PreCompact arrived but PostCompact didn't.
    const hadChange = a.state !== 'idle' || a.tool !== null || a.compacting;
    if (!hadChange) return;
    a.state = 'idle';
    a.tool = null;
    a.compacting = false;
    a.detail = null;
    this.emitAll();
  }

  /**
   * A turn starts (UserPromptSubmit). `selfStarted`: Claude Code started it
   * itself, with a background subagent's report; that doesn't undo an
   * interrupt the user made, so the end still counts as seen.
   */
  setBusy(ptyId: string, { selfStarted = false }: { selfStarted?: boolean } = {}): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    this.cancelSettle(a);
    a.mainTurn = true;
    if (!selfStarted) a.interrupted = false;
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
    this.cancelSettle(a);
    if (a.state === 'waiting') return;
    a.state = 'waiting';
    a.tool = null;
    a.detail = null;
    a.interrupted = false;
    this.emitAll();
  }

  /**
   * The user pressed Escape or Ctrl+C in the agent pane. Claude Code treats
   * either as an interrupt while a turn is running or a permission prompt is
   * up, and — by design — does not fire the Stop hook for it, so nothing else
   * brings the dot back from "running". The supervisor listing can't be
   * relied on either: its `status` goes stale (a `done` job has reported
   * `busy` for hours), and its idle lands a poll or two later. So the
   * keystroke is the signal, and like a hook it keeps precedence over the
   * listing for one poll interval. The idle it leaves is `interrupted`: the
   * user's own act, so seen. Either key while already idle just closes menus
   * or clears the prompt; nothing to do.
   */
  setInterrupted(ptyId: string, key: 'escape' | 'ctrl-c' = 'escape'): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    // Busy on subagents alone means Claude sits at its prompt.
    const parked = a.state === 'busy' && !a.mainTurn && a.subagents.size > 0;
    if (a.state === 'waiting' || (a.state === 'busy' && !parked)) {
      // The main turn ends; background subagents run on (live: neither Esc
      // nor Ctrl+C mid-turn stops them), so they keep the task busy.
      a.mainTurn = false;
    } else if (parked && key === 'ctrl-c') {
      // Ctrl+C at the prompt stops the background agents, and no
      // SubagentStop follows (live, 2.1.332).
      a.subagents.clear();
    } else {
      return;
    }
    a.lastHookTime = Date.now();
    this.cancelSettle(a);
    a.state = a.subagents.size > 0 ? 'busy' : 'idle';
    a.tool = null;
    a.compacting = false;
    a.detail = null;
    a.interrupted = true;
    this.emitAll();
  }

  /**
   * The main agent finished responding (Stop). `running`: the background
   * subagents Claude Code still lists (`background_tasks`), the truth when
   * present. With any left the task stays busy; otherwise it goes idle after
   * TURN_SETTLE_MS, unless a turn starts first. True when nothing runs on,
   * i.e. the turn really is over.
   */
  endTurn(ptyId: string, running?: readonly string[]): boolean {
    const a = this.activities.get(ptyId);
    if (!a) return false;
    a.lastHookTime = Date.now();
    const cleared = a.tool !== null || a.compacting;
    a.mainTurn = false;
    a.tool = null;
    a.compacting = false;
    if (running) a.subagents = new Set(running);
    if (a.subagents.size > 0) {
      this.cancelSettle(a);
      if (a.state !== 'busy') {
        a.state = 'busy';
        a.detail = null;
      }
      this.emitAll();
      return false;
    }
    if (cleared) this.emitAll();
    this.settleIdle(ptyId, a);
    return true;
  }

  /** A background (or foreground) subagent started or resumed. */
  subagentStart(ptyId: string, agentId: string): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    const now = Date.now();
    a.lastHookTime = now;
    a.lastSubagentTime = now;
    this.cancelSettle(a);
    a.subagents.add(agentId);
    if (a.state !== 'idle') return;
    a.state = 'busy';
    a.detail = null;
    this.emitAll();
  }

  /**
   * A subagent finished. `running`: the list its SubagentStop carries, which
   * still names the stopping agent itself; the rest is the truth. The last
   * one out ends the work unless the main turn is running.
   */
  subagentStop(ptyId: string, agentId: string, running?: readonly string[]): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    const now = Date.now();
    a.lastHookTime = now;
    a.lastSubagentTime = now;
    if (running) a.subagents = new Set(running.filter((id) => id !== agentId));
    else a.subagents.delete(agentId);
    this.emitAll();
    if (a.subagents.size === 0 && !a.mainTurn && a.state === 'busy') this.settleIdle(ptyId, a);
  }

  /** Any other hook from inside a subagent: it is alive. */
  noteSubagentHook(ptyId: string): void {
    const a = this.activities.get(ptyId);
    if (a) a.lastSubagentTime = Date.now();
  }

  setToolStart(ptyId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const a = this.activities.get(ptyId);
    if (!a) return;
    a.lastHookTime = Date.now();
    this.cancelSettle(a);
    a.mainTurn = true;
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
    this.cancelSettle(a);
    this.endWork(a);
    a.state = 'error';
    a.tool = null;
    a.error = { type: mappedType, message };
    a.interrupted = false;
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
      const tool = a.tool ?? subagentsLabel(a);
      if (tool) info.tool = tool;
      if (a.error) info.error = a.error;
      if (a.compacting) info.compacting = true;
      if (a.detail) info.detail = a.detail;
      if (a.interrupted && a.state === 'idle') info.interrupted = true;
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
        this.cancelSettle(a);
        this.endWork(a);
        a.state = 'idle';
        a.tool = null;
        a.compacting = false;
        changed = true;
      }
    }
    if (changed) this.emitAll();
  }

  /** Nothing runs any more: no main turn, no subagents. */
  private endWork(a: PtyActivity): void {
    a.mainTurn = false;
    a.subagents.clear();
  }

  /** Go idle after TURN_SETTLE_MS if nothing starts meanwhile. */
  private settleIdle(ptyId: string, a: PtyActivity): void {
    if (a.settle) return;
    a.settle = setTimeout(() => {
      a.settle = null;
      if (this.activities.get(ptyId) !== a) return;
      if (a.mainTurn || a.subagents.size > 0) return;
      if (a.state !== 'busy' && a.state !== 'waiting') return;
      a.state = 'idle';
      a.tool = null;
      a.compacting = false;
      a.detail = null;
      this.emitAll();
    }, TURN_SETTLE_MS);
  }

  private cancelSettle(a: PtyActivity): void {
    if (!a.settle) return;
    clearTimeout(a.settle);
    a.settle = null;
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
