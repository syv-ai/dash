import { TerminalSessionManager } from './TerminalSessionManager';
import type { LoopRole, PermissionMode } from '../../shared/types';

interface AttachOptions {
  id: string;
  cwd: string;
  container: HTMLElement;
  permissionMode?: PermissionMode;
  shellOnly?: boolean;
  isTui?: boolean;
  themeId?: string;
  /** Owning task id when it differs from the PTY id (loop:/mgr: composite ids). */
  loopTaskId?: string;
  /** Skip --resume: spawn a fresh Claude session (loop agents; Ralph reset). */
  freshContext?: boolean;
  /** Prompt auto-submitted after the trust gate (loop worker/manager seed). */
  initialPrompt?: string;
  /** Loop agent role; main derives model/permission/prompt/deny-settings from it. */
  loopRole?: LoopRole;
}

class SessionRegistryImpl {
  private sessions = new Map<string, TerminalSessionManager>();
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
        loopTaskId: opts.loopTaskId,
        freshContext: opts.freshContext,
        initialPrompt: opts.initialPrompt,
        loopRole: opts.loopRole,
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
