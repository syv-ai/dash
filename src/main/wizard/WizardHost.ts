import type { BrowserWindow } from 'electron';
import { IpcWizardChannel } from './WizardChannel';
import { TUI_PROTOCOL_VERSION } from '../../shared/tuiProtocol';

export interface WizardHandle {
  start(): Promise<void>;
  teardown(): Promise<void>;
}

export interface WizardWiring {
  socket: IpcWizardChannel;
  onTeardown(reason: string | null): void;
}

export interface SpawnOpts {
  featureId: string;
  taskId: string;
  projectId: string;
  cwd: string;
  createWizard(wiring: WizardWiring): WizardHandle;
  getMainWindow(): BrowserWindow | null;
}

/**
 * One wizard's lifecycle within the host. Three states, a session-scoped state
 * machine (NOT independent flags):
 *
 *   - `pending`    spawn in flight. Recorded synchronously at spawn() entry so
 *                  the migrate path can notify the renderer before the wizard is
 *                  fully wired without the task-switch effect racing in a second.
 *   - `active`     the wizard is running; its toast is live in the renderer.
 *   - `suppressed` finished this session (declined, completed, migrated). A Dash
 *                  restart asks again. A spawn FAILURE is removed entirely so the
 *                  user can retry by switching tasks.
 */
type EngagementState = 'pending' | 'active' | 'suppressed';
interface Engagement {
  state: EngagementState;
  wizard?: WizardHandle;
  channel?: IpcWizardChannel;
}

/**
 * Hosts wizard flows whose UI is a persistent renderer toast. Replaces the old
 * side-car TUI host: no PTY, no socket, no drawer tab — the orchestrator's
 * messages are forwarded to the renderer over IPC (`ports:wizard:show`) and the
 * renderer's choices are routed back via `routeMessage`. Engagements are keyed
 * by `${featureId}:${taskId}`.
 */
export class WizardHost {
  private engagements = new Map<string, Engagement>();
  // Projects the user said "Not now" to this session, keyed `${featureId}:${projectId}`.
  // Unlike "Never" (persisted in feature_dismissals), this is session-only — a
  // Dash restart re-offers — but it spans every task in the project, so picking
  // "Not now" on one task doesn't re-prompt on its siblings.
  private snoozedProjects = new Set<string>();
  private reloadWork: Promise<void> | null = null;

  private key(featureId: string, taskId: string): string {
    return `${featureId}:${taskId}`;
  }

  private projectKey(featureId: string, projectId: string): string {
    return `${featureId}:${projectId}`;
  }

  /** True once we've engaged this feature+task this session (any state). */
  isActive(featureId: string, taskId: string): boolean {
    return this.engagements.has(this.key(featureId, taskId));
  }

  /** True when the user picked "Not now" for any task in this project this session. */
  isProjectSnoozed(featureId: string, projectId: string): boolean {
    return this.snoozedProjects.has(this.projectKey(featureId, projectId));
  }

  /** True only while a wizard is genuinely running (pending or active). */
  isLive(featureId: string, taskId: string): boolean {
    const state = this.engagements.get(this.key(featureId, taskId))?.state;
    return state === 'pending' || state === 'active';
  }

  async spawn(opts: SpawnOpts): Promise<{ taskId: string }> {
    const key = this.key(opts.featureId, opts.taskId);
    let registered = false;
    this.engagements.set(key, { state: 'pending' });

    const channel = new IpcWizardChannel((msg) => {
      const win = opts.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('wizard:show', {
          featureId: opts.featureId,
          taskId: opts.taskId,
          msg,
        });
      }
    });

    try {
      const wizard = opts.createWizard({
        socket: channel,
        onTeardown: (reason) => {
          const win = opts.getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('wizard:dismiss', {
              featureId: opts.featureId,
              taskId: opts.taskId,
            });
          }
          if (!registered) return;
          // A clean exit suppresses respawn for the session; an 'error' frees
          // the key so the user can retry by switching back to the task.
          if (reason === 'error') this.engagements.delete(key);
          else this.engagements.set(key, { state: 'suppressed' });
          // "Not now" snoozes the whole project for the session so the offer
          // doesn't reappear on sibling tasks (the per-task suppress above only
          // covers this one).
          if (reason === 'not-now') {
            this.snoozedProjects.add(this.projectKey(opts.featureId, opts.projectId));
          }
        },
      });
      await wizard.start();

      this.engagements.set(key, { state: 'active', wizard, channel });
      registered = true;

      // The renderer toast is always available — there's no side-car `ready`
      // handshake to wait for, so synthesize one to drive the first screen.
      channel.receive({ type: 'ready', version: TUI_PROTOCOL_VERSION });

      return { taskId: opts.taskId };
    } catch (err) {
      this.engagements.delete(key);
      throw err;
    }
  }

  /** Route a renderer-originated message (choice/exit) to the active wizard. */
  routeMessage(featureId: string, taskId: string, msg: unknown): void {
    this.engagements.get(this.key(featureId, taskId))?.channel?.receive(msg);
  }

  /**
   * Tear down any live wizard for a task — called when the task is deleted so
   * its toast doesn't linger pointing at a gone task. Teardown dismisses the
   * toast via onTeardown.
   */
  async cancelForTask(taskId: string): Promise<void> {
    await Promise.all(
      [...this.engagements.entries()]
        .filter(([key, e]) => key.endsWith(`:${taskId}`) && e.state === 'active')
        .map(async ([, e]) => {
          try {
            await e.wizard!.teardown();
          } catch {
            /* best effort */
          }
        }),
    );
  }

  /**
   * Renderer reload (Cmd+R): a fresh session. Tear down every live wizard and
   * forget all engagements so anything still relevant is re-offered on remount.
   */
  async handleRendererReload(): Promise<void> {
    const work = (async () => {
      const live = [...this.engagements.values()].filter((e) => e.state === 'active');
      await Promise.all(
        live.map(async (e) => {
          try {
            await e.wizard!.teardown();
          } catch {
            /* best effort */
          }
        }),
      );
      this.engagements.clear();
      this.snoozedProjects.clear();
    })();
    this.reloadWork = work;
    await work;
  }

  reloadSettled(): Promise<void> {
    return this.reloadWork ?? Promise.resolve();
  }
}
