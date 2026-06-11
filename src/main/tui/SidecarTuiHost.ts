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
 * Generic spawn assembly for side-car TUIs: socket server + drawer tab +
 * side-car PTY + flow lifecycle, with rollback on partial failure. One host
 * for the whole app; entries are keyed by `${featureId}:${taskId}`.
 */
export class SidecarTuiHost {
  /**
   * Keys whose spawn is in flight but not yet registered in `active`. Added
   * SYNCHRONOUSLY at spawn() entry: the migrate path notifies the renderer
   * right after calling spawn(), and the renderer's task-switch effect checks
   * isActive() — without the synchronous add it would race in and spawn a
   * second flow for the new task.
   */
  private pending = new Set<string>();
  private active = new Map<string, WizardHandle>();
  /**
   * Keys whose TUI finished this session (declined, completed, migrated away,
   * or closed). Session-scoped on purpose: a Dash restart asks again. Spawn
   * FAILURES ('error' reason, or rollback before registration) are
   * deliberately NOT suppressed so the user can retry by switching tasks.
   */
  private suppressed = new Set<string>();
  /** In-flight reload reset — requestStart awaits this to avoid racing it. */
  private reloadWork: Promise<void> | null = null;

  constructor(private readonly deps: HostDeps) {}

  isActive(featureId: string, taskId: string): boolean {
    const key = `${featureId}:${taskId}`;
    return this.pending.has(key) || this.active.has(key) || this.suppressed.has(key);
  }

  async spawn(opts: SpawnOpts): Promise<{ tabId: string }> {
    const key = `${opts.featureId}:${opts.taskId}`;
    const sockPath = path.join(
      this.deps.socketDir,
      `tui-${opts.featureId}-${opts.taskId}-${crypto.randomBytes(4).toString('hex')}.sock`,
    );
    const tabId = `tui:${opts.featureId}:${opts.taskId}`;

    let socket: TuiSocketServer | null = null;
    let flow: WizardHandle | null = null;
    let tabCreated = false;
    // Set once registered in `active`. The flow's onTeardown fires on the
    // rollback path too — before registration it must neither delete a live
    // entry nor suppress a retry.
    let registered = false;
    this.pending.add(key);

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

      flow = opts.createWizard({
        socket,
        onTeardown: (reason) => {
          try {
            this.deps.drawerTabs.close(tab.id);
          } catch {
            // Already closed (rollback path closes it too).
          }
          if (!registered) return;
          this.active.delete(key);
          if (reason !== 'error') this.suppressed.add(key);
        },
      });
      await flow.start();

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

      this.active.set(key, flow);
      registered = true;
      return { tabId: tab.id };
    } catch (err) {
      if (flow) {
        try {
          await flow.teardown();
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
      throw err;
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * Renderer reload (Cmd+R) — side-car TUIs can't survive it: clack output
   * replayed from the mirror into a fresh xterm breaks formatting, so the
   * tab + side-car are torn down and the renderer's mount-time requestStart
   * re-offers anything still relevant. A reload counts as a fresh session,
   * so the session-scoped suppression set is cleared too.
   */
  async handleRendererReload(): Promise<void> {
    const work = (async () => {
      const entries = [...this.active.entries()];
      await Promise.all(
        entries.map(async ([key, flow]) => {
          try {
            // WizardOrchestrator.teardown → onTeardown closes the tab and
            // drops the active entry; the explicit cleanup below covers a
            // flow whose teardown throws before reaching it.
            await flow.teardown();
          } catch {
            /* best effort */
          }
          this.active.delete(key);
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
      this.suppressed.clear();
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
