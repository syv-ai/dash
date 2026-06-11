import path from 'path';
import * as fs from 'fs';
import crypto from 'crypto';
import type { BrowserWindow } from 'electron';
import { TuiSocketServer } from '../services/TuiSocketServer';

export interface WizardHandle {
  start(): Promise<void>;
  teardown(): Promise<void>;
}

export interface WizardWiring {
  socket: TuiSocketServer;
  onTeardown(reason: string | null): void;
}

export interface SpawnOpts {
  featureId: string;
  taskId: string;
  projectId: string;
  cwd: string;
  cols: number;
  rows: number;
  tabLabel: string;
  /**
   * Make the new tab the task's active drawer tab. Off by default — an
   * unrequested CTA (onboarding) must not steal focus; the migrate path
   * turns it on because the user explicitly asked for that TUI.
   */
  activate?: boolean;
  /** Extra env for the side-car process (e.g. DASH_TUI_PROJECT_NAME). */
  env?: Record<string, string>;
  createWizard(wiring: WizardWiring): WizardHandle;
  getMainWindow(): BrowserWindow | null;
}

export interface HostDeps {
  socketDir: string;
  scriptPath: string;
  drawerTabs: {
    add(
      taskId: string,
      opts: { kind: 'tui'; label: string; featureId: string; id: string },
    ): { id: string };
    close(tabId: string): void;
    setActive(taskId: string, tabId: string): void;
  };
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
  }): Promise<unknown>;
  /** Kill a side-car PTY by tab id (no-op when already gone). */
  killPty(id: string): void;
}

/**
 * One side-car wizard's lifecycle within the host. The three states are a
 * session-scoped state machine, NOT three independent flags:
 *
 *   - `pending`    spawn in flight, not yet running. Recorded SYNCHRONOUSLY at
 *                  spawn() entry: the migrate path notifies the renderer right
 *                  after calling spawn(), and the renderer's task-switch effect
 *                  checks isActive() — without the synchronous reserve it would
 *                  race in and spawn a second wizard for the same task.
 *   - `active`     the side-car PTY is up and the wizard is running.
 *   - `suppressed` finished this session (declined, completed, migrated away,
 *                  or closed). A Dash restart asks again. A spawn FAILURE is
 *                  removed entirely (not suppressed) so the user can retry by
 *                  switching tasks.
 *
 * isActive() is true for ANY state — "have we already engaged this
 * feature+task this session?" — so one Map.has() answers it.
 */
type EngagementState = 'pending' | 'active' | 'suppressed';
interface Engagement {
  state: EngagementState;
  /** Present only while state === 'active'. */
  wizard?: WizardHandle;
}

/**
 * Generic spawn assembly for side-car TUIs: socket server + drawer tab +
 * side-car PTY + wizard lifecycle, with rollback on partial failure. One host
 * for the whole app; engagements are keyed by `${featureId}:${taskId}`.
 */
export class SidecarTuiHost {
  private engagements = new Map<string, Engagement>();
  /** In-flight reload reset — requestStart awaits this to avoid racing it. */
  private reloadWork: Promise<void> | null = null;

  constructor(private readonly deps: HostDeps) {}

  private key(featureId: string, taskId: string): string {
    return `${featureId}:${taskId}`;
  }

  /** True once we've engaged this feature+task this session (any state). */
  isActive(featureId: string, taskId: string): boolean {
    return this.engagements.has(this.key(featureId, taskId));
  }

  async spawn(opts: SpawnOpts): Promise<{ tabId: string }> {
    const key = this.key(opts.featureId, opts.taskId);
    const sockPath = path.join(
      this.deps.socketDir,
      `tui-${opts.featureId}-${opts.taskId}-${crypto.randomBytes(4).toString('hex')}.sock`,
    );
    const tabId = `tui:${opts.featureId}:${opts.taskId}`;

    let socket: TuiSocketServer | null = null;
    let wizard: WizardHandle | null = null;
    let tabCreated = false;
    // Set once the engagement reaches 'active'. The wizard's onTeardown fires
    // on the rollback path too — before registration it must neither change a
    // live entry nor suppress a retry.
    let registered = false;
    this.engagements.set(key, { state: 'pending' });

    try {
      socket = new TuiSocketServer(sockPath);
      await socket.listen();

      const tab = this.deps.drawerTabs.add(opts.taskId, {
        kind: 'tui',
        label: opts.tabLabel,
        featureId: opts.featureId,
        id: tabId,
      });
      tabCreated = true;
      if (opts.activate) this.deps.drawerTabs.setActive(opts.taskId, tab.id);

      wizard = opts.createWizard({
        socket,
        onTeardown: (reason) => {
          try {
            this.deps.drawerTabs.close(tab.id);
          } catch {
            // Already closed (rollback path closes it too).
          }
          if (!registered) return;
          // A clean exit suppresses respawn for the session; an 'error' frees
          // the key so the user can retry by switching back to the task.
          if (reason === 'error') this.engagements.delete(key);
          else this.engagements.set(key, { state: 'suppressed' });
        },
      });
      await wizard.start();

      if (!fs.existsSync(this.deps.scriptPath)) {
        throw new Error(
          `TUI bundle missing at ${this.deps.scriptPath}. Run \`pnpm build:tui\` and try again.`,
        );
      }

      const win = opts.getMainWindow();
      await this.deps.startPty({
        id: tab.id,
        command: process.execPath,
        args: [this.deps.scriptPath],
        cwd: opts.cwd,
        cols: opts.cols,
        rows: opts.rows,
        env: {
          DASH_TUI_SOCKET: sockPath,
          DASH_TUI_FEATURE: opts.featureId,
          // Electron binary runs as plain Node when this is set.
          ELECTRON_RUN_AS_NODE: '1',
          ...opts.env,
        },
        owner: win?.webContents ?? null,
        taskId: opts.taskId,
        featureId: opts.featureId,
      });

      this.engagements.set(key, { state: 'active', wizard });
      registered = true;
      return { tabId: tab.id };
    } catch (err) {
      if (wizard) {
        try {
          await wizard.teardown();
        } catch {
          /* best effort */
        }
      }
      if (socket) {
        try {
          await socket.close();
        } catch {
          /* best effort */
        }
      }
      if (tabCreated) {
        try {
          this.deps.drawerTabs.close(tabId);
        } catch {
          /* best effort */
        }
      }
      // Never registered (a throw can't land between the 'active' set and the
      // return) — drop the pending reserve so the user can retry.
      this.engagements.delete(key);
      throw err;
    }
  }

  /**
   * Renderer reload (Cmd+R) — side-car TUIs can't survive it: clack output
   * replayed from the mirror into a fresh xterm breaks formatting, so the
   * tab + side-car are torn down and the renderer's mount-time requestStart
   * re-offers anything still relevant. A reload counts as a fresh session,
   * so every engagement is forgotten too.
   */
  async handleRendererReload(): Promise<void> {
    const work = (async () => {
      const live = [...this.engagements.entries()].filter(([, e]) => e.state === 'active');
      await Promise.all(
        live.map(async ([key, e]) => {
          try {
            // WizardOrchestrator.teardown → onTeardown closes the tab; the
            // explicit cleanup below covers a wizard whose teardown throws
            // before reaching it.
            await e.wizard!.teardown();
          } catch {
            /* best effort */
          }
          const tabId = `tui:${key}`;
          try {
            this.deps.drawerTabs.close(tabId);
          } catch {
            /* already closed */
          }
          try {
            this.deps.killPty(tabId);
          } catch {
            /* already gone */
          }
        }),
      );
      // Fresh session: forget every engagement (pending / active / suppressed)
      // so anything still relevant is re-offered on the renderer's remount.
      this.engagements.clear();
    })();
    this.reloadWork = work;
    await work;
  }

  /** Resolves once any in-flight reload reset has finished. */
  reloadSettled(): Promise<void> {
    return this.reloadWork ?? Promise.resolve();
  }

  /**
   * Unlink socket files left by a previous run (the kernel orphans them on
   * crash; bind would fail with EADDRINUSE otherwise). Matches the legacy
   * `ports-tui-*` prefix too — drop that after a release or two.
   */
  sweepSockets(): void {
    try {
      for (const f of fs.readdirSync(this.deps.socketDir)) {
        if (f.startsWith('tui-') || f.startsWith('ports-tui-')) {
          try {
            fs.unlinkSync(path.join(this.deps.socketDir, f));
          } catch {
            /* gone */
          }
        }
      }
    } catch {
      /* dir doesn't exist yet */
    }
  }
}
