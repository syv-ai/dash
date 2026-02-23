import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { TerminalSnapshot } from '../../shared/types';
import { FilePathLinkProvider } from './FilePathLinkProvider';
import { darkTheme, lightTheme, resolveTheme } from './terminalThemes';

const SNAPSHOT_DEBOUNCE_MS = 10_000;
const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024; // 128MB soft limit

export class TerminalSessionManager {
  readonly id: string;
  readonly cwd: string;
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private serializeAddon: SerializeAddon;
  private resizeObserver: ResizeObserver | null = null;
  private snapshotDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotDirty = false;
  private dataBuffer: string[] | null = null;
  private unsubData: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private ptyStarted = false;
  private disposed = false;
  private opened = false;
  private autoApprove: boolean;
  private currentContainer: HTMLElement | null = null;
  private boundBeforeUnload: (() => void) | null = null;
  private attachGeneration = 0;
  private isDark = true;
  private _isRestarting = false;
  private onRestartingCallback: (() => void) | null = null;
  private onReadyCallback: (() => void) | null = null;
  private readyFired = false;
  private readyFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private onScrollStateChangeCallback: ((isAtBottom: boolean) => void) | null = null;
  private lastEmittedAtBottom = true;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private _currentCwd: string;
  private onCwdChangeCallback: ((cwd: string) => void) | null = null;
  private fitDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPtyCols = 0;
  private lastPtyRows = 0;
  readonly shellOnly: boolean;
  private themeId: string;
  constructor(opts: {
    id: string;
    cwd: string;
    autoApprove?: boolean;
    isDark?: boolean;
    shellOnly?: boolean;
    themeId?: string;
  }) {
    this.id = opts.id;
    this.cwd = opts.cwd;
    this._currentCwd = opts.cwd;
    this.autoApprove = opts.autoApprove ?? false;
    this.isDark = opts.isDark ?? true;
    this.shellOnly = opts.shellOnly ?? false;
    this.themeId = opts.themeId ?? 'default';

    this.terminal = new Terminal({
      scrollback: 100_000,
      fontSize: 13,
      lineHeight: 1.2,
      allowProposedApi: true,
      theme: resolveTheme(this.themeId, this.isDark),
      cursorBlink: true,
      linkHandler: {
        activate: (_event, uri) => {
          window.electronAPI.openExternal(uri);
        },
      },
    });

    this.fitAddon = new FitAddon();
    this.serializeAddon = new SerializeAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        window.electronAPI.openExternal(uri);
      }),
    );

    // Register file path link provider (click to open in editor)
    this.terminal.registerLinkProvider(
      new FilePathLinkProvider(
        this.terminal,
        () => this._currentCwd,
        (filePath, line, col) => {
          window.electronAPI.openInEditor({
            cwd: this._currentCwd,
            filePath,
            line,
            col,
          });
        },
      ),
    );

    // Track cwd via OSC 7 (emitted by zsh on macOS by default)
    this.terminal.parser.registerOscHandler(7, (data) => {
      try {
        const url = new URL(data);
        if (url.protocol === 'file:') {
          const path = decodeURIComponent(url.pathname);
          if (path && path !== this._currentCwd) {
            this._currentCwd = path;
            this.onCwdChangeCallback?.(path);
          }
        }
      } catch {
        // Ignore malformed OSC 7 data
      }
      return false;
    });

    this.terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // Shift+Enter → Ctrl+J (multiline input for Claude Code)
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        window.electronAPI.ptyInput({ id: this.id, data: '\x0A' });
        return false;
      }

      // Cmd+Left → Home (Ctrl+A), Cmd+Right → End (Ctrl+E), Cmd+Backspace → Kill line (Ctrl+U)
      if (e.metaKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        window.electronAPI.ptyInput({ id: this.id, data: '\x01' });
        return false;
      }
      if (e.metaKey && e.key === 'ArrowRight') {
        e.preventDefault();
        window.electronAPI.ptyInput({ id: this.id, data: '\x05' });
        return false;
      }
      if (e.metaKey && e.key === 'Backspace') {
        e.preventDefault();
        window.electronAPI.ptyInput({ id: this.id, data: '\x15' });
        return false;
      }

      return true;
    });

    // Send input to PTY
    this.terminal.onData((data) => {
      window.electronAPI.ptyInput({ id: this.id, data });
    });

    // Track scroll position to notify UI when user scrolls away from bottom
    this.terminal.onScroll(() => this.emitScrollState());
    this.terminal.onWriteParsed(() => this.emitScrollState());

    // Wheel events on the xterm viewport may not trigger onScroll when terminal
    // lacks focus. Listen directly and recheck after the browser processes the event.
    this.wheelHandler = () => {
      requestAnimationFrame(() => this.emitScrollState());
    };
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
    const gen = ++this.attachGeneration;
    if (this.disposed) return;
    this.currentContainer = container;

    if (!this.opened) {
      // First time: open xterm in this container
      this.terminal.open(container);
      this.opened = true;
      // Load GPU addon after terminal is in DOM
      await this.loadGpuAddon();
      // After yielding, check if a newer attach() has started (React remount)
      if (gen !== this.attachGeneration) return;
    } else {
      // Re-attach: move the xterm element back into the visible container
      const xtermEl = this.terminal.element;
      if (xtermEl && xtermEl.parentElement !== container) {
        container.appendChild(xtermEl);
      }
    }

    // Wheel listener for scroll detection even without terminal focus
    if (this.wheelHandler) {
      container.addEventListener('wheel', this.wheelHandler, { passive: true });
    }

    // Resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver((entries) => {
      // Skip when container is collapsed/hidden to avoid resizing PTY to 0 rows
      const rect = entries[0]?.contentRect;
      if (!rect || rect.height < 10) return;
      if (this.fitDebounceTimer) clearTimeout(this.fitDebounceTimer);
      this.fitDebounceTimer = setTimeout(() => {
        this.fitDebounceTimer = null;
        this.fit();
      }, 100);
    });
    this.resizeObserver.observe(container);

    // Save snapshot on page unload (CMD+R) so it's always available on reload
    if (!this.boundBeforeUnload) {
      this.boundBeforeUnload = () => {
        if (this.snapshotDirty && this.opened) {
          this.saveSnapshot();
        }
      };
      window.addEventListener('beforeunload', this.boundBeforeUnload);
    }

    // Start PTY if not started (first attach)
    let reattached = false;
    let isDirectSpawn = false;
    if (!this.ptyStarted) {
      if (this.shellOnly) {
        // Shell-only mode: just spawn a shell, skip Claude CLI
        let existingSnapshot: TerminalSnapshot | null = null;
        try {
          const snapshotResp = await window.electronAPI.ptyGetSnapshot(this.id);
          if (snapshotResp.success && snapshotResp.data) {
            existingSnapshot = snapshotResp.data;
          }
        } catch {
          // Best effort
        }
        if (gen !== this.attachGeneration) return;

        const dims = this.fitAddon.proposeDimensions();
        const shellResp = await window.electronAPI.ptyStart({
          id: this.id,
          cwd: this.cwd,
          cols: dims?.cols ?? 120,
          rows: dims?.rows ?? 30,
        });
        if (gen !== this.attachGeneration) return;
        reattached = shellResp.data?.reattached ?? false;
        this.ptyStarted = true;

        if (existingSnapshot && !reattached) {
          try {
            this.terminal.write(existingSnapshot.data);
          } catch {
            // Best effort
          }
        }
      } else {
        // Claude Code mode: try direct spawn, fall back to shell
        let resume = false;
        let existingSnapshot: TerminalSnapshot | null = null;
        try {
          const snapshotResp = await window.electronAPI.ptyGetSnapshot(this.id);
          if (snapshotResp.success && snapshotResp.data) {
            existingSnapshot = snapshotResp.data;
            // Only check for session if we have a snapshot (nothing to resume without one)
            const sessionResp = await window.electronAPI.ptyHasClaudeSession(this.cwd);
            if (sessionResp.success && sessionResp.data) {
              resume = true;
            }
          }
        } catch {
          // Best effort
        }
        if (gen !== this.attachGeneration) return;

        let result = await this.startPty(resume);
        if (gen !== this.attachGeneration) return;

        // If we reattached to an existing direct-spawn PTY (e.g. after CMD+R),
        // kill it and spawn fresh with resume. Ink's internal cursor state can't
        // be recovered via SIGWINCH, but a fresh Claude Code process with
        // --continue --resume preserves the session and gives a clean TUI init.
        if (result.reattached && result.isDirectSpawn) {
          this._isRestarting = true;
          this.readyFired = false;
          this.onRestartingCallback?.();
          window.electronAPI.ptyKill(this.id);
          this.ptyStarted = false;
          result = await this.startPty(resume);
          if (gen !== this.attachGeneration) return;

          // Fallback: hide overlay after 10s even if no data arrives
          this.readyFallbackTimer = setTimeout(() => {
            this.fireReady();
          }, 10_000);
        }

        isDirectSpawn = result.isDirectSpawn;

        // Show previous snapshot for visual context while Claude starts
        if (existingSnapshot && !result.reattached) {
          try {
            this.terminal.write(existingSnapshot.data);
          } catch {
            // Best effort
          }
        }

        // Show info line when issue context was injected via SessionStart hook
        if (result.taskContextMeta && !result.reattached && !resume) {
          const { issueNumbers, gitRemote } = result.taskContextMeta;
          const issueLabels = issueNumbers.map((num) => {
            const url = gitRemote ? this.issueUrl(gitRemote, num) : null;
            // OSC 8 hyperlink: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
            return url ? `\x1b]8;;${url}\x07#${num}\x1b]8;;\x07` : `#${num}`;
          });
          this.terminal.write(
            `\x1b[2m\x1b[36m● Issue context injected: ${issueLabels.join(', ')}\x1b[0m\r\n`,
          );
        }
      }
    }

    {
      // Hide xterm's real cursor for direct spawns — Ink renders its own
      // character cursor in the input field; xterm's cursor just blinks
      // at the wrong position (end of buffer). Skip for shell-only.
      if (isDirectSpawn && !this.shellOnly) {
        this.terminal.write('\x1b[?25l');
      }

      this.connectPtyListeners();

      requestAnimationFrame(() => {
        if (gen !== this.attachGeneration) return;
        this.fitAddon.fit();
        this.terminal.focus();

        const dims = this.fitAddon.proposeDimensions();
        if (!dims || dims.cols <= 0 || dims.rows <= 0) return;

        window.electronAPI.ptyResize({
          id: this.id,
          cols: dims.cols,
          rows: dims.rows,
        });
      });
    }
  }

  detach() {
    // Save snapshot before detaching
    this.saveSnapshot();

    // Stop timers
    if (this.snapshotDebounceTimer) {
      clearTimeout(this.snapshotDebounceTimer);
      this.snapshotDebounceTimer = null;
    }
    if (this.readyFallbackTimer) {
      clearTimeout(this.readyFallbackTimer);
      this.readyFallbackTimer = null;
    }
    if (this.fitDebounceTimer) {
      clearTimeout(this.fitDebounceTimer);
      this.fitDebounceTimer = null;
    }

    // Remove wheel listener
    if (this.currentContainer && this.wheelHandler) {
      this.currentContainer.removeEventListener('wheel', this.wheelHandler);
    }

    // Clear callbacks to prevent stale setState on unmounted components
    this.onRestartingCallback = null;
    this.onReadyCallback = null;
    this.onScrollStateChangeCallback = null;
    this.onCwdChangeCallback = null;
    this._isRestarting = false;

    // Stop resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.currentContainer = null;
    // Terminal element stays in DOM but container will be unmounted by React
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.boundBeforeUnload) {
      window.removeEventListener('beforeunload', this.boundBeforeUnload);
      this.boundBeforeUnload = null;
    }

    this.saveSnapshot();

    if (this.snapshotDebounceTimer) {
      clearTimeout(this.snapshotDebounceTimer);
      this.snapshotDebounceTimer = null;
    }
    if (this.fitDebounceTimer) {
      clearTimeout(this.fitDebounceTimer);
      this.fitDebounceTimer = null;
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

  onRestarting(cb: () => void) {
    this.onRestartingCallback = cb;
  }

  onReady(cb: () => void) {
    this.onReadyCallback = cb;
    // If ready already fired before the callback was registered, call immediately
    if (this.readyFired) {
      cb();
    }
  }

  writeInput(data: string) {
    window.electronAPI.ptyInput({ id: this.id, data });
  }

  focus() {
    this.terminal.focus();
  }

  get currentCwd(): string {
    return this._currentCwd;
  }

  onCwdChange(cb: ((cwd: string) => void) | null) {
    this.onCwdChangeCallback = cb;
  }

  onScrollStateChange(cb: (isAtBottom: boolean) => void) {
    this.onScrollStateChangeCallback = cb;
  }

  scrollToBottom() {
    const viewport = this.terminal.element?.querySelector('.xterm-viewport');
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      // Emit state once smooth scroll finishes
      const onScrollEnd = () => {
        this.emitScrollState();
        viewport.removeEventListener('scrollend', onScrollEnd);
      };
      viewport.addEventListener('scrollend', onScrollEnd);
      // Fallback if scrollend doesn't fire
      setTimeout(() => {
        viewport.removeEventListener('scrollend', onScrollEnd);
        this.emitScrollState();
      }, 500);
    } else {
      this.terminal.scrollToBottom();
      this.emitScrollState();
    }
  }

  setTheme(isDark: boolean) {
    this.setTerminalTheme(this.themeId, isDark);
  }

  setTerminalTheme(themeId: string, isDark: boolean) {
    this.themeId = themeId;
    this.isDark = isDark;
    try {
      this.terminal.options.theme = resolveTheme(themeId, isDark);
    } catch {
      // WebGL addon may crash if GPU context is lost (e.g. hidden terminal).
      // Re-apply after reloading the addon on next attach.
    }

    // Trigger SIGWINCH so the TUI redraws with the new ANSI palette.
    // rows+1 then rows forces the PTY process to handle SIGWINCH.
    if (this.ptyStarted && this.opened) {
      const dims = this.fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        window.electronAPI.ptyResize({ id: this.id, cols: dims.cols, rows: dims.rows + 1 });
        setTimeout(() => {
          window.electronAPI.ptyResize({ id: this.id, cols: dims.cols, rows: dims.rows });
        }, 50);
      }
    }
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
        // Skip redundant PTY resizes to avoid SIGWINCH prompt redraw
        if (dims.cols === this.lastPtyCols && dims.rows === this.lastPtyRows) return;
        this.lastPtyCols = dims.cols;
        this.lastPtyRows = dims.rows;
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

  private issueUrl(remote: string, num: number): string | null {
    const ssh = remote.match(/git@github\.com:(.+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}/issues/${num}`;
    const https = remote.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
    if (https) return `https://github.com/${https[1]}/issues/${num}`;
    return null;
  }

  private async startPty(resume: boolean = false): Promise<{
    reattached: boolean;
    isDirectSpawn: boolean;
    taskContextMeta: { issueNumbers: number[]; gitRemote?: string } | null;
  }> {
    const dims = this.fitAddon.proposeDimensions();
    const cols = dims?.cols ?? 120;
    const rows = dims?.rows ?? 30;

    let reattached = false;
    let isDirectSpawn = false;
    let taskContextMeta: { issueNumbers: number[]; gitRemote?: string } | null = null;

    const resp = await window.electronAPI.ptyStartDirect({
      id: this.id,
      cwd: this.cwd,
      cols,
      rows,
      autoApprove: this.autoApprove,
      resume,
      isDark: this.isDark,
    });

    if (resp.success) {
      reattached = resp.data?.reattached ?? false;
      isDirectSpawn = resp.data?.isDirectSpawn ?? true;
      taskContextMeta = resp.data?.taskContextMeta ?? null;
    } else {
      // Fall back to shell — warn the user so they know why they see a shell
      this.terminal.writeln(
        '\x1b[33m⚠ Could not start Claude CLI directly — falling back to shell.\x1b[0m',
      );
      this.terminal.writeln(
        '\x1b[33m  Install with: npm install -g @anthropic-ai/claude-code\x1b[0m\r\n',
      );

      const shellResp = await window.electronAPI.ptyStart({
        id: this.id,
        cwd: this.cwd,
        cols,
        rows,
      });
      reattached = shellResp.data?.reattached ?? false;
      isDirectSpawn = shellResp.data?.isDirectSpawn ?? false;
    }

    this.ptyStarted = true;

    return { reattached, isDirectSpawn, taskContextMeta };
  }

  private fireReady() {
    if (this.readyFired) return;
    this.readyFired = true;
    this._isRestarting = false;
    if (this.readyFallbackTimer) {
      clearTimeout(this.readyFallbackTimer);
      this.readyFallbackTimer = null;
    }
    // Re-hide xterm cursor — Ink's init sends \x1b[?25h which overrides
    // the cursor hide we wrote before data started flowing
    this.terminal.write('\x1b[?25l');
    if (this.onReadyCallback) {
      this.onReadyCallback();
    }
  }

  private connectPtyListeners() {
    // Clean up old listeners
    if (this.unsubData) this.unsubData();
    if (this.unsubExit) this.unsubExit();

    let firedDataReady = false;

    // Listen for PTY data
    this.unsubData = window.electronAPI.onPtyData(this.id, (data) => {
      if (this.disposed) return;

      // Buffer data during snapshot restore to prevent interleaving
      if (this.dataBuffer !== null) {
        this.dataBuffer.push(data);
        return;
      }

      // On first data after a restart, fire ready after 800ms delay
      // to let Ink finish rendering the TUI
      if (this._isRestarting && !firedDataReady) {
        firedDataReady = true;
        setTimeout(() => this.fireReady(), 800);
      }

      this.terminal.write(data);
      this.snapshotDirty = true;
      this.checkMemory();
      this.debounceSaveSnapshot();
    });

    // Listen for PTY exit → spawn shell fallback
    this.unsubExit = window.electronAPI.onPtyExit(this.id, (info) => {
      if (this.disposed) return;

      // Show xterm's real cursor for the shell fallback
      this.terminal.write('\x1b[?25h');

      this.terminal.writeln(`\r\n\x1b[90m[Process exited with code ${info.exitCode}]\x1b[0m\r\n`);

      // Ensure PTY is cleaned up in main process before spawning shell
      window.electronAPI.ptyKill(this.id);

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
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  private saveSnapshot() {
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
      window.electronAPI.ptySaveSnapshot(this.id, snapshot);
      this.snapshotDirty = false;
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

  private isAtBottom(): boolean {
    const buf = this.terminal.buffer.active;
    return buf.baseY - buf.viewportY <= 10;
  }

  private emitScrollState() {
    const atBottom = this.isAtBottom();
    if (atBottom !== this.lastEmittedAtBottom) {
      this.lastEmittedAtBottom = atBottom;
      this.onScrollStateChangeCallback?.(atBottom);
    }
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
