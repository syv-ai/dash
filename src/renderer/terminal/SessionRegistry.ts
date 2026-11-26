import { TerminalSessionManager } from './TerminalSessionManager';
import type { TerminalActivity } from './resizeVeil';
import type { PermissionMode } from '../../shared/types';
import { shouldHibernate } from './hibernation';

interface AttachOptions {
  id: string;
  cwd: string;
  container: HTMLElement;
  permissionMode?: PermissionMode;
  shellOnly?: boolean;
  isTui?: boolean;
  themeId?: string;
}

class SessionRegistryImpl {
  private sessions = new Map<string, TerminalSessionManager>();
  private activityListeners = new Map<string, Set<(activity: TerminalActivity) => void>>();
  private _isDark = true;
  private _themeId = 'default';

  getOrCreate(opts: Omit<AttachOptions, 'container'>): TerminalSessionManager {
    let session = this.sessions.get(opts.id);
    if (!session) {
      session = new TerminalSessionManager({
        id: opts.id,
        cwd: opts.cwd,
        permissionMode: opts.permissionMode,
        isDark: this._isDark,
        shellOnly: opts.shellOnly,
        isTui: opts.isTui,
        themeId: opts.themeId ?? this._themeId,
        onActivity: (activity) => {
          for (const listener of this.activityListeners.get(opts.id) ?? []) listener(activity);
        },
      });
      this.sessions.set(opts.id, session);
    }
    return session;
  }

  attach(opts: AttachOptions): TerminalSessionManager {
    const session = this.getOrCreate(opts);
    void session.attach(opts.container);
    return session;
  }

  detach(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.detach();
    }
  }

  /** Hear session `id`'s resizes, fits and output, whether or not it exists
   *  yet (a pane's veil mounts before the pane attaches). Returns the
   *  unsubscribe. */
  onActivity(id: string, listener: (activity: TerminalActivity) => void): () => void {
    let listeners = this.activityListeners.get(id);
    if (!listeners) this.activityListeners.set(id, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.activityListeners.delete(id);
    };
  }

  get(id: string): TerminalSessionManager | undefined {
    return this.sessions.get(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  async dispose(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      session.dispose();
      this.sessions.delete(id);
    }
  }

  /**
   * Hibernate every task terminal unseen for longer than `afterMs`: dispose
   * its xterm and close its attach client. The session keeps running; the
   * next pane mount creates the terminal again and re-attaches. Returns the
   * ids it hibernated.
   */
  hibernateIdle(now: number, afterMs: number, remoteControl: (id: string) => boolean): string[] {
    const out: string[] = [];
    for (const [id, session] of this.sessions) {
      if (!shouldHibernate({ ...session.rest, remoteControl: remoteControl(id) }, now, afterMs)) {
        continue;
      }
      session.dispose();
      this.sessions.delete(id);
      out.push(id);
    }
    return out;
  }

  async disposeByPrefix(prefix: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (id.startsWith(prefix)) {
        session.dispose();
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Restart every agent + shell PTY associated with a task. Used by the
   * port-management flow so new env vars are picked up without losing the
   * agent's Claude session. TUI PTYs (e.g. the ports onboarding TUI) are
   * filtered out — they don't read the same env and a forced restart would
   * tear down their state machine mid-flow.
   */
  async restartAllForTask(taskId: string): Promise<void> {
    const resp = await window.electronAPI.ptyListForTask(taskId, {
      kinds: ['agent', 'shell'],
    });
    if (!resp.success || !resp.data) return;
    const targets: TerminalSessionManager[] = [];
    for (const id of resp.data) {
      const session = this.sessions.get(id);
      if (session) targets.push(session);
    }
    await Promise.all(targets.map((s) => s.restart()));
  }

  /**
   * Restart a task's agent session so it is dispatched again (fresh
   * environment and spawn args, same Claude session). A mounted pane restarts
   * in place; otherwise main stops the job and the next attach dispatches.
   */
  async restartAgent(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (session) await session.restart();
    else await window.electronAPI.ptyRestartSession(taskId);
  }

  setAllThemes(isDark: boolean): void {
    this._isDark = isDark;
    this.setAllTerminalThemes(this._themeId, isDark);
  }

  setAllTerminalThemes(themeId: string, isDark: boolean): void {
    this._themeId = themeId;
    this._isDark = isDark;
    for (const session of this.sessions.values()) {
      session.setTerminalTheme(themeId, isDark);
    }
  }

  setAllTerminalFonts(fontFamily: string): void {
    for (const session of this.sessions.values()) {
      session.setTerminalFont(fontFamily);
    }
  }

  async disposeAll(): Promise<void> {
    for (const [id, session] of this.sessions) {
      session.dispose();
      this.sessions.delete(id);
    }
  }
}

export const sessionRegistry = new SessionRegistryImpl();
