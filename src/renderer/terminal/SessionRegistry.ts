import { TerminalSessionManager } from './TerminalSessionManager';
import { FONT_SIZE_DEFAULT, LINE_HEIGHT_DEFAULT } from './terminalFonts';

interface AttachOptions {
  id: string;
  cwd: string;
  container: HTMLElement;
  autoApprove?: boolean;
  shellOnly?: boolean;
  themeId?: string;
}

class SessionRegistryImpl {
  private sessions = new Map<string, TerminalSessionManager>();
  private _isDark = true;
  private _themeId = 'default';
  private _fontFamily: string | null = null;
  private _fontSize: number = FONT_SIZE_DEFAULT;
  private _lineHeight: number = LINE_HEIGHT_DEFAULT;

  getOrCreate(opts: Omit<AttachOptions, 'container'>): TerminalSessionManager {
    let session = this.sessions.get(opts.id);
    if (!session) {
      session = new TerminalSessionManager({
        id: opts.id,
        cwd: opts.cwd,
        autoApprove: opts.autoApprove,
        isDark: this._isDark,
        shellOnly: opts.shellOnly,
        themeId: opts.themeId ?? this._themeId,
        fontFamily: this._fontFamily,
        fontSize: this._fontSize,
        lineHeight: this._lineHeight,
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

  async disposeByPrefix(prefix: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (id.startsWith(prefix)) {
        await session.dispose();
        this.sessions.delete(id);
      }
    }
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

  setAllTerminalFont(fontFamily: string | null, fontSize: number, lineHeight: number): void {
    this._fontFamily = fontFamily;
    this._fontSize = fontSize;
    this._lineHeight = lineHeight;
    for (const session of this.sessions.values()) {
      session.setTerminalFont(fontFamily, fontSize, lineHeight);
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
