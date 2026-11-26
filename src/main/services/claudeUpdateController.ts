import type {
  ActivityInfo,
  ClaudeUpdateMode,
  ClaudeUpdateRestart,
  ClaudeUpdateState,
} from '@shared/types';
import {
  activeTaskIds,
  findOutdated,
  nextDeferredStep,
  type LiveSessionVersion,
} from './claudeUpdatePlan';
import { parseClaudeVersion } from './claudeCli';

export interface ClaudeUpdateDeps {
  getActivity: () => Record<string, ActivityInfo>;
  /** Restart the task's session on the installed Claude Code, keeping its conversation. */
  restartTask: (taskId: string) => Promise<void>;
  publish: (state: ClaudeUpdateState) => void;
}

interface Request {
  mode: ClaudeUpdateMode;
  /** Sessions this request already restarted: each goes once. */
  restarted: Set<string>;
}

/**
 * The "restart sessions on the new Claude Code" flow, free of Electron: it is
 * fed the installed version, the live sessions' versions and activity
 * changes, and restarts sessions through `deps.restartTask`.
 *
 * A request restarts sessions one at a time. "now" restarts every outdated
 * session whatever it is doing. "whenDone" fires only when no task in the app
 * is working or asking (nextDeferredStep); during its batch each session is
 * checked again just before its restart, and one that has become active is
 * skipped and waited for, so a prompt sent mid-restart is never cut off.
 */
export class ClaudeUpdateController {
  private installed: string | null = null;
  private sessions: LiveSessionVersion[] = [];
  private request: Request | null = null;
  private batch: { done: number; total: number } | null = null;
  private lastPublished = '';

  constructor(private readonly deps: ClaudeUpdateDeps) {}

  setInstalled(version: string | null): void {
    this.installed = version;
    this.evaluate();
  }

  setSessions(sessions: LiveSessionVersion[]): void {
    this.sessions = sessions;
    this.evaluate();
  }

  onActivity(): void {
    this.evaluate();
  }

  /** Start a request, or switch the pending one to `mode`. */
  restart(mode: ClaudeUpdateMode): void {
    if (this.request) this.request.mode = mode;
    else this.request = { mode, restarted: new Set() };
    this.evaluate();
  }

  /** Drop the request. A restart already under way finishes; no further one starts. */
  cancel(): void {
    this.request = null;
    this.evaluate();
  }

  getState(): ClaudeUpdateState {
    const parsed = parseClaudeVersion(this.installed);
    return {
      installedVersion: parsed ? parsed.join('.') : null,
      outdated: findOutdated(this.installed, this.sessions),
      restart: this.restartState(),
    };
  }

  private restartState(): ClaudeUpdateRestart {
    if (this.batch) return { phase: 'restarting', ...this.batch };
    if (this.request?.mode === 'whenDone') {
      return { phase: 'waiting', activeTaskIds: activeTaskIds(this.deps.getActivity()) };
    }
    return { phase: 'none' };
  }

  private evaluate(): void {
    if (this.request && !this.batch) {
      const outdated = findOutdated(this.installed, this.sessions).map((s) => s.taskId);
      const step = nextDeferredStep({
        outdated,
        // "now" doesn't wait for anyone.
        active: this.request.mode === 'now' ? [] : activeTaskIds(this.deps.getActivity()),
        restarted: this.request.restarted,
      });
      if (step.kind === 'finished') this.request = null;
      else if (step.kind === 'restart') void this.runBatch(step.taskIds);
    }
    this.publish();
  }

  private async runBatch(taskIds: string[]): Promise<void> {
    this.batch = { done: 0, total: taskIds.length };
    this.publish();
    try {
      for (const taskId of taskIds) {
        const request = this.request;
        if (!request) break; // cancelled
        const active = activeTaskIds(this.deps.getActivity()).includes(taskId);
        if (request.mode === 'whenDone' && active) {
          this.batch.done++;
          continue; // started working meanwhile: wait for it
        }
        request.restarted.add(taskId);
        try {
          await this.deps.restartTask(taskId);
        } catch (err) {
          console.warn(`[ClaudeUpdate] restarting task ${taskId} failed:`, err);
        }
        this.batch.done++;
        this.publish();
      }
    } finally {
      this.batch = null;
      this.evaluate();
    }
  }

  private publish(): void {
    const state = this.getState();
    const key = JSON.stringify(state);
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.deps.publish(state);
  }
}
