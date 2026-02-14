import { TerminalSessionManager } from './TerminalSessionManager';

interface AttachOptions {
  id: string;
  cwd: string;
  container: HTMLElement;
  autoApprove?: boolean;
}

class SessionRegistryImpl {
  private sessions = new Map<string, TerminalSessionManager>();
  private _isDark = true;

  getOrCreate(opts: Omit<AttachOptions, 'container'>): TerminalSessionManager {
    let session = this.sessions.get(opts.id);
    if (!session) {
      session = new TerminalSessionManager({
        id: opts.id,
        cwd: opts.cwd,
        autoApprove: opts.autoApprove,
        isDark: this._isDark,
      });
      this.sessions.set(opts.id, session);
    }
    return session;
  }

  attach(opts: AttachOptions): TerminalSessionManager {
    const session = this.getOrCreate(opts);
    session.attach(opts.container);
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
      await session.dispose();
      this.sessions.delete(id);
    }
  }

  setAllThemes(isDark: boolean): void {
    this._isDark = isDark;
    for (const session of this.sessions.values()) {
      session.setTheme(isDark);
    }
  }

  async disposeAll(): Promise<void> {
    for (const [id, session] of this.sessions) {
      await session.dispose();
      this.sessions.delete(id);
    }
  }

  /**
   * Force-save snapshots for all active sessions.
   * Called before app quit so terminal state persists across restarts.
   */
  async saveAllSnapshots(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.forceSaveSnapshot();
    }
  }
}

export const sessionRegistry = new SessionRegistryImpl();
