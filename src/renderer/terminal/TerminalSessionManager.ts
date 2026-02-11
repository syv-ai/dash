import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { TerminalSnapshot } from '../../shared/types';

const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024; // 128MB soft limit

const darkTheme = {
  background: '#1a1a1a',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1a1a1a',
  selectionBackground: '#3a3a5a',
  black: '#000000',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d4d4d4',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const lightTheme = {
  background: '#ffffff',
  foreground: '#383a42',
  cursor: '#383a42',
  cursorAccent: '#ffffff',
  selectionBackground: '#bfceff',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#696c77',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#ffffff',
};

export class TerminalSessionManager {
  readonly id: string;
  readonly cwd: string;
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private serializeAddon: SerializeAddon;
  private resizeObserver: ResizeObserver | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubData: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private ptyStarted = false;
  private disposed = false;
  private opened = false;
  private autoApprove: boolean;
  private currentContainer: HTMLElement | null = null;
  private boundBeforeUnload: (() => void) | null = null;
  private suppressCursorShow = false;

  constructor(opts: { id: string; cwd: string; autoApprove?: boolean }) {
    this.id = opts.id;
    this.cwd = opts.cwd;
    this.autoApprove = opts.autoApprove ?? false;

    this.terminal = new Terminal({
      scrollback: 100_000,
      fontSize: 13,
      lineHeight: 1.2,
      allowProposedApi: true,
      theme: darkTheme,
      cursorBlink: true,
    });

    this.fitAddon = new FitAddon();
    this.serializeAddon = new SerializeAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    // Shift+Enter → Ctrl+J (multiline input for Claude Code)
    this.terminal.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        window.electronAPI.ptyInput({ id: this.id, data: '\x0A' });
        return false;
      }
      return true;
    });

    // Send input to PTY
    this.terminal.onData((data) => {
      window.electronAPI.ptyInput({ id: this.id, data });
    });
  }

  private async loadGpuAddon() {
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
      });
      this.terminal.loadAddon(webgl);
    } catch {
      try {
        const { CanvasAddon } = await import('@xterm/addon-canvas');
        this.terminal.loadAddon(new CanvasAddon());
      } catch {
        // Software renderer fallback
      }
    }
  }

  async attach(container: HTMLElement) {
    if (this.disposed) return;
    this.currentContainer = container;

    if (!this.opened) {
      // First time: open xterm in this container
      this.terminal.open(container);
      this.opened = true;
      // Load GPU addon after terminal is in DOM
      await this.loadGpuAddon();
    } else {
      // Re-attach: move the xterm element back into the visible container
      const xtermEl = this.terminal.element;
      if (xtermEl && xtermEl.parentElement !== container) {
        container.appendChild(xtermEl);
      }
    }

    // Resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(container);

    // Save snapshot on page unload (CMD+R) so it's always available on reload
    if (!this.boundBeforeUnload) {
      this.boundBeforeUnload = () => {
        this.saveSnapshot();
      };
      window.addEventListener('beforeunload', this.boundBeforeUnload);
    }

    // Start PTY if not started (first attach)
    let reattached = false;
    if (!this.ptyStarted) {
      await this.initializeTerminal();
    }

    // For reattached sessions, suppress xterm's real cursor immediately.
    // Ink's TUI renders its own visual cursor as a styled character;
    // xterm's real cursor would appear at the wrong position (end of buffer).
    // Must be set before any PTY data arrives (SIGWINCH redraw).
    if (reattached) {
      this.suppressCursorShow = true;
      this.terminal.write('\x1b[?25l');
    }

    // Re-attach (page reload): restore terminal content from snapshot,
    // falling back to SIGWINCH if no snapshot exists.
    let snapshotRestored = false;
    if (reattached) {
      snapshotRestored = await this.restoreSnapshot();
    }

    // Fit canvas and send dimensions after layout settles
    requestAnimationFrame(() => {
      this.fitAddon.fit();
      this.terminal.focus();

      const dims = this.fitAddon.proposeDimensions();
      if (!dims || dims.cols <= 0 || dims.rows <= 0) return;

      if (reattached && !snapshotRestored) {
        // No snapshot — force TUI redraw via SIGWINCH.
        // Use rows+1 then correct rows (col changes affect wrapping).
        // Cursor-show sequences from Ink's redraw are stripped by the
        // data listener (suppressCursorShow), so no phantom cursor.
        window.electronAPI.ptyResize({
          id: this.id,
          cols: dims.cols,
          rows: dims.rows + 1,
        });
        setTimeout(() => {
          window.electronAPI.ptyResize({
            id: this.id,
            cols: dims.cols,
            rows: dims.rows,
          });
        }, 300);
      } else {
        // Normal case or snapshot restored — just send correct dimensions
        window.electronAPI.ptyResize({
          id: this.id,
          cols: dims.cols,
          rows: dims.rows,
        });
      }
    });

    // Snapshot timer
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = setInterval(() => this.saveSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  detach() {
    // Save snapshot before detaching
    this.saveSnapshot();

    // Stop timers
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.snapshotDebounceTimer) {
      clearTimeout(this.snapshotDebounceTimer);
      this.snapshotDebounceTimer = null;
    }

    // Stop resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.currentContainer = null;
    // Terminal element stays in DOM but container will be unmounted by React
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.boundBeforeUnload) {
      window.removeEventListener('beforeunload', this.boundBeforeUnload);
      this.boundBeforeUnload = null;
    }

    await this.saveSnapshot();

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.snapshotDebounceTimer) {
      clearTimeout(this.snapshotDebounceTimer);
      this.snapshotDebounceTimer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.unsubData) this.unsubData();
    if (this.unsubExit) this.unsubExit();

    window.electronAPI.ptyKill(this.id);
    this.terminal.dispose();
  }

  writeInput(data: string) {
    window.electronAPI.ptyInput({ id: this.id, data });
  }

  focus() {
    this.terminal.focus();
  }

  setTheme(isDark: boolean) {
    this.terminal.options.theme = isDark ? darkTheme : lightTheme;
  }

  /** Public wrapper for saving snapshot (used by SessionRegistry on app quit). */
  async forceSaveSnapshot(): Promise<void> {
    await this.saveSnapshot();
  }

  private fit() {
    try {
      this.fitAddon.fit();
      const dims = this.fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        window.electronAPI.ptyResize({
          id: this.id,
          cols: dims.cols,
          rows: dims.rows,
        });
      }
    } catch {
      // Ignore fit errors during transitions
    }
  }

  /**
   * Initialize terminal with snapshot restore and resume support.
   *
   * For Claude CLI (which supports -r resume):
   *   - Check if a Claude session exists for this cwd
   *   - If yes: spawn with resume=true (CLI restores conversation via -r)
   *     Skip snapshot restore since the CLI will replay its own output
   *   - If no: spawn fresh (no resume, no snapshot)
   *
   * For shell fallback (no resume support):
   *   - Restore snapshot for visual context, then spawn shell
   */
  private async initializeTerminal() {
    // Check for existing snapshot
    let snapshot: TerminalSnapshot | null = null;
    try {
      const resp = await window.electronAPI.ptyGetSnapshot(this.id);
      if (resp.success && resp.data) {
        snapshot = resp.data;
      }
    } catch {
      // Best effort
    }

    // Check if Claude has an existing session for this working directory
    let hasSession = false;
    if (snapshot) {
      try {
        const resp = await window.electronAPI.ptyHasClaudeSession(this.cwd);
        if (resp.success && resp.data) {
          hasSession = true;
        }
      } catch {
        // Best effort
      }
    }

    await this.startPty(hasSession);

    // For resume-capable CLIs, the CLI handles history replay — skip snapshot.
    // For non-resume cases (no session found, or shell fallback), show the snapshot
    // so the user sees their previous terminal output.
    if (snapshot && !hasSession) {
      try {
        this.terminal.write(snapshot.data);
      } catch {
        // Best effort
      }
    }
  }

  private async startPty(resume: boolean = false) {
    const dims = this.fitAddon.proposeDimensions();
    const cols = dims?.cols ?? 120;
    const rows = dims?.rows ?? 30;

    let reattached = false;

    const resp = await window.electronAPI.ptyStartDirect({
      id: this.id,
      cwd: this.cwd,
      cols,
      rows,
      autoApprove: this.autoApprove,
      resume,
    });

    if (resp.success) {
      reattached = resp.data?.reattached ?? false;
    } else {
      // Fall back to shell
      const shellResp = await window.electronAPI.ptyStart({
        id: this.id,
        cwd: this.cwd,
        cols,
        rows,
      });
      reattached = shellResp.data?.reattached ?? false;
    }

    this.ptyStarted = true;
    this.connectPtyListeners();

    return reattached;
  }

  private connectPtyListeners() {
    // Clean up old listeners
    if (this.unsubData) this.unsubData();
    if (this.unsubExit) this.unsubExit();

    // Listen for PTY data
    this.unsubData = window.electronAPI.onPtyData(this.id, (data) => {
      if (!this.disposed) {
        // After snapshot restore, xterm's real cursor is at the wrong position.
        // Ink's TUI renders its own visual cursor, so we strip cursor-show
        // sequences to keep xterm's cursor hidden.
        // eslint-disable-next-line no-control-regex
        const filtered = this.suppressCursorShow ? data.replace(/\x1b\[\?25h/g, '') : data;
        this.terminal.write(filtered);
        this.checkMemory();
        this.debounceSaveSnapshot();
      }
    });

    // Listen for PTY exit → spawn shell fallback
    this.unsubExit = window.electronAPI.onPtyExit(this.id, (info) => {
      if (this.disposed) return;

      // Shell needs the real cursor — stop suppressing
      this.suppressCursorShow = false;
      this.terminal.write('\x1b[?25h');

      this.terminal.writeln(`\r\n\x1b[90m[Process exited with code ${info.exitCode}]\x1b[0m\r\n`);

      // Spawn shell fallback
      const dims = this.fitAddon.proposeDimensions();
      window.electronAPI
        .ptyStart({
          id: this.id,
          cwd: this.cwd,
          cols: dims?.cols ?? 120,
          rows: dims?.rows ?? 30,
        })
        .then(() => {
          this.connectPtyListeners();
        });
    });
  }

  private debounceSaveSnapshot() {
    if (this.snapshotDebounceTimer) clearTimeout(this.snapshotDebounceTimer);
    this.snapshotDebounceTimer = setTimeout(() => {
      this.snapshotDebounceTimer = null;
      this.saveSnapshot();
    }, 3000);
  }

  private async saveSnapshot() {
    if (this.disposed || !this.opened) return;
    try {
      const data = this.serializeAddon.serialize();
      const dims = this.fitAddon.proposeDimensions();
      const snapshot: TerminalSnapshot = {
        version: 1,
        createdAt: new Date().toISOString(),
        cols: dims?.cols ?? 120,
        rows: dims?.rows ?? 30,
        data,
      };
      await window.electronAPI.ptySaveSnapshot(this.id, snapshot);
    } catch {
      // Best effort
    }
  }

  private async restoreSnapshot(): Promise<boolean> {
    try {
      const resp = await window.electronAPI.ptyGetSnapshot(this.id);
      if (resp.success && resp.data && resp.data.data) {
        this.terminal.write(resp.data.data);
        return true;
      }
    } catch {
      // Best effort
    }
    return false;
  }

  private checkMemory() {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      if (mem.usedJSHeapSize > MEMORY_LIMIT_BYTES) {
        this.terminal.options.scrollback = 10_000;
        this.terminal.clear();
        this.terminal.options.scrollback = 100_000;
      }
    }
  }
}
