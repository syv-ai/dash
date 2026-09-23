import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { Utf8Base64 } from './Utf8Base64';
import type { PermissionMode, TerminalSnapshot } from '../../shared/types';
import { FilePathLinkProvider } from './FilePathLinkProvider';
import type { ITheme } from '@xterm/xterm';
import { darkTheme, lightTheme, resolveTheme } from './terminalThemes';
import { getTerminalFont } from './terminalFonts';
import { ptyExitFallback, foreignSessionJobId } from './ptyExitFallback';
import { clackBlock, clackExitBlock } from './clackLines';
import { isPromptOnlySnapshot } from './snapshotFilter';
import { FitScheduler } from './FitScheduler';
import { MouseModeTracker } from './mouseModeFilter';
import { macShellKeySequence } from './shellKeys';

// Heap mark above which a terminal trims its own scrollback to relieve pressure.
// `performance.memory.usedJSHeapSize` is the WHOLE renderer heap (React, Monaco,
// every terminal), so the mark must clear normal baseline usage (Monaco alone
// puts a working app at 130–160MB) — otherwise the trim fires constantly. Only
// genuine pressure should trip it.
const MEMORY_LIMIT_BYTES = 600 * 1024 * 1024; // 600MB
// Don't re-check more often than this; the trim is sticky so one pass per window
// is plenty and it must never run per output chunk (that was the flicker bug).
const MEMORY_CHECK_INTERVAL_MS = 5_000;
// Floor the scrollback never drops below when trimming under pressure.
const MIN_SCROLLBACK = 10_000;

export class TerminalSessionManager {
  readonly id: string;
  readonly cwd: string;
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private searchAddon: SearchAddon;
  private resizeObserver: ResizeObserver | null = null;
  private dataBuffer: string[] | null = null;
  private unsubData: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private ptyStarted = false;
  private disposed = false;
  private opened = false;
  private permissionMode: PermissionMode;
  private currentContainer: HTMLElement | null = null;
  private attachGeneration = 0;
  private isDark = true;
  private _isRestarting = false;
  private onRestartingCallback: (() => void) | null = null;
  private onDetachedCallback: ((info: { exitCode: number } | null) => void) | null = null;
  private detachedInfo: { exitCode: number } | null = null;
  private onReadyCallback: (() => void) | null = null;
  private readyFired = false;
  private readyFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private _currentCwd: string;
  private onCwdChangeCallback: ((cwd: string) => void) | null = null;
  private onFindKey: (() => void) | null = null;
  // 250ms debounce covers panel-transition animations (200ms) to avoid
  // fitting at intermediate sizes; cancels itself when the container hides
  private fitScheduler = new FitScheduler(() => this.fit(), 250);
  // Swallows Claude Code's redundant mouse-mode re-assertions, which would
  // otherwise make xterm drop the selection on every TUI growth.
  private mouseModes = new MouseModeTracker();
  private lastPtyCols = 0;
  private lastPtyRows = 0;
  private lastMemoryCheckAt = 0;
  private savedViewportY: number | null = null;
  // Shell-only sessions use xterm 6's DOM renderer (WebGL paints their
  // transparent background black). The DOM renderer lays each row's glyphs at
  // the font's real advance, which runs slightly wider than xterm's reported
  // `css.cell.width`; over a full row that drift pushes the last glyph past the
  // right gutter. We measure the real advance from a rendered row and divide by
  // it (instead of the under-reported cell width) when sizing the grid. Unset
  // until the first row has rendered. WebGL terminals snap to the cell grid, so
  // this stays undefined for them.
  private domCellWidth?: number;
  // A fresh shell spawn stays blank for ~1.5s while the user's dotfiles load
  // before the shell prints its first prompt. We paint a dim `folder $` ghost
  // the instant the terminal is ready, then wipe it when real output arrives so
  // the handoff is seamless. True only while the ghost is on screen.
  private placeholderActive = false;
  readonly shellOnly: boolean;
  readonly isTui: boolean;
  private themeId: string;
  // Claude Code's TUI rewrites cells continuously, which causes xterm to drop
  // the visible selection before the user can press the copy shortcut. Cache
  // the last non-empty selection on every change so Ctrl+Shift+C / Cmd+C can
  // still copy it even after xterm has cleared the highlight.
  private lastSelection = '';
  constructor(opts: {
    id: string;
    cwd: string;
    permissionMode?: PermissionMode;
    isDark?: boolean;
    shellOnly?: boolean;
    /**
     * True when the underlying PTY was spawned by main (side-car TUIs and
     * service runs). The attach path then verifies the PTY exists instead
     * of falling back to a shell, and renders an error line if it's gone.
     */
    isTui?: boolean;
    themeId?: string;
  }) {
    this.id = opts.id;
    this.cwd = opts.cwd;
    this._currentCwd = opts.cwd;
    this.permissionMode = opts.permissionMode ?? 'default';
    this.isDark = opts.isDark ?? true;
    this.shellOnly = opts.shellOnly ?? false;
    this.isTui = opts.isTui ?? false;
    this.themeId = opts.themeId ?? 'default';

    this.terminal = new Terminal({
      scrollback: 100_000,
      fontSize: 13,
      fontFamily: getTerminalFont(),
      lineHeight: 1.2,
      allowProposedApi: true,
      // Shell-only sessions sit on the floating right-pane glass — render
      // with alpha so the frosted background shows through xterm's canvas.
      allowTransparency: this.shellOnly,
      theme: this.effectiveTheme(resolveTheme(this.themeId, this.isDark)),
      cursorBlink: true,
      linkHandler: {
        activate: (_event, uri) => {
          void window.electronAPI.openExternal(uri);
        },
      },
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(new ClipboardAddon(new Utf8Base64()));
    this.terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void window.electronAPI.openExternal(uri);
      }),
    );

    // Register file path link provider (click to open in editor)
    this.terminal.registerLinkProvider(
      new FilePathLinkProvider(
        this.terminal,
        () => this._currentCwd,
        (filePath, line, col) => {
          window.electronAPI
            .openInEditor({
              cwd: this._currentCwd,
              filePath,
              line,
              col,
            })
            .then((res) => {
              if (!res.success) {
                console.warn('[FilePathLink] openInEditor failed:', res.error);
              }
            })
            .catch((err) => {
              console.warn('[FilePathLink] openInEditor error:', err);
            });
        },
      ),
    );

    // Cache selection on every change — Claude Code's TUI rewrites cells as the
    // user drags, which clears xterm's selection before the copy shortcut fires.
    this.terminal.onSelectionChange(() => {
      const sel = this.terminal.getSelection();
      if (sel) this.lastSelection = sel;
    });

    // Keep selections alive across Claude Code re-renders (#144): drop a
    // DECSET that only re-asserts mouse modes already in effect. See
    // mouseModeFilter.ts for why xterm would otherwise clear the selection.
    this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) =>
      this.mouseModes.onSet(params),
    );
    this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      this.mouseModes.onReset(params);
      return false;
    });

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

      const isMac = navigator.userAgent.includes('Mac');

      // Drawer shell: Option/Cmd+arrows move by word / to line ends, as in
      // Terminal.app. Agent panes keep xterm's encoding for Claude Code.
      if (isMac && this.shellOnly) {
        const seq = macShellKeySequence(e);
        if (seq) {
          e.preventDefault();
          window.electronAPI.ptyInput({ id: this.id, data: seq });
          return false;
        }
      }

      // Match by physical key (e.code) so alternate keyboard layouts where
      // Ctrl+Shift+C reports e.key as something other than 'C' still work.
      const isKeyC = e.code === 'KeyC';
      const isKeyV = e.code === 'KeyV';

      // Copy: Cmd+C (macOS) or Ctrl+Shift+C (Linux) — copy terminal selection.
      // Also Ctrl+C on any platform when there's an active selection (matches
      // native terminal behaviour: Ctrl+C copies when selected, sends SIGINT
      // otherwise). Explicit shortcuts fall back to lastSelection so users can
      // still copy after the TUI has cleared xterm's highlight.
      const isExplicitCopy =
        (isMac && e.metaKey && isKeyC && !e.ctrlKey) ||
        (!isMac && e.ctrlKey && e.shiftKey && isKeyC);
      const isPlainCtrlC = e.ctrlKey && !e.shiftKey && isKeyC && this.terminal.hasSelection();
      if (isExplicitCopy || isPlainCtrlC) {
        const sel = this.terminal.getSelection() || (isExplicitCopy ? this.lastSelection : '');
        if (sel) {
          e.preventDefault();
          window.electronAPI.clipboardWriteText(sel);
          return false;
        }
      }

      // Paste: Cmd+V (macOS) or Ctrl+Shift+V (Linux)
      if (
        (isMac && e.metaKey && isKeyV && !e.ctrlKey) ||
        (!isMac && e.ctrlKey && e.shiftKey && isKeyV)
      ) {
        e.preventDefault();
        void window.electronAPI.clipboardReadText().then((text) => {
          if (text) window.electronAPI.ptyInput({ id: this.id, data: text });
        });
        return false;
      }

      // Select all: Cmd+A (macOS) or Ctrl+Shift+A (Linux). xterm binds Cmd+A
      // itself on macOS; handling it here too keeps both platforms explicit and
      // stops Electron's default Edit menu from also running its selectAll role.
      if (
        e.code === 'KeyA' &&
        !e.altKey &&
        ((isMac && e.metaKey && !e.ctrlKey && !e.shiftKey) ||
          (!isMac && e.ctrlKey && e.shiftKey && !e.metaKey))
      ) {
        e.preventDefault();
        this.terminal.selectAll();
        return false;
      }

      // Find: Cmd+F (macOS) or Ctrl+F (Linux/Win). Intercepted at the xterm
      // layer so the binding fires even while the terminal owns keyboard
      // focus. Caller wires this to the in-terminal search overlay.
      if (
        this.onFindKey &&
        e.code === 'KeyF' &&
        !e.shiftKey &&
        !e.altKey &&
        ((isMac && e.metaKey && !e.ctrlKey) || (!isMac && e.ctrlKey && !e.metaKey))
      ) {
        e.preventDefault();
        this.onFindKey();
        return false;
      }

      // Ctrl+Tab — let it bubble to window for rotation cycling
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        return false;
      }

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
  }

  /** `terminal.reset()` drops every DEC private mode, so the mouse-mode
   *  tracker must forget them too or the next real DECSET would be swallowed. */
  private resetTerminal(): void {
    this.terminal.reset();
    this.mouseModes.clear();
  }

  private async loadGpuAddon() {
    // Shell-only sessions render transparent (allowTransparency: true, theme
    // background rgba(0,0,0,0)) so the floating right-pane glass shows through.
    // xterm 6's WebGL renderer paints a transparent background as solid black,
    // so use the built-in DOM renderer for these — it composites alpha
    // correctly. (Opaque main terminals keep WebGL for output performance.)
    if (this.shellOnly) return; // built-in DOM renderer — alpha-correct

    // xterm 6 removed the canvas renderer; the choices are WebGL or xterm's
    // built-in DOM renderer. On Linux, WebGL has had compositing bugs that
    // blank the terminal on content updates (typing, output), so we use the
    // DOM renderer there. NOTE: the DOM renderer historically clips the last
    // glyph of full rows — re-verify on Linux under the current Chromium.
    const isLinux = navigator.userAgent.includes('Linux');
    if (isLinux) return; // built-in DOM renderer

    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        void this.loadGpuAddon();
      });
      this.terminal.loadAddon(webgl);
    } catch (err) {
      // A GPU-renderer failure drops to xterm's DOM renderer; log it so that
      // regression is visible, not mysterious.
      console.warn('[terminal] WebGL renderer failed, using DOM renderer:', err);
    }
  }

  async attach(container: HTMLElement, opts?: { autoFocus?: boolean }) {
    const gen = ++this.attachGeneration;
    if (this.disposed) return;
    this.currentContainer = container;

    if (!this.opened) {
      // First time: open xterm in this container
      this.terminal.open(container);
      this.opened = true;
      // Sync .xterm background so padding gutters match the theme
      const bg = this.effectiveTheme(resolveTheme(this.themeId, this.isDark)).background;
      if (this.terminal.element && bg) {
        this.terminal.element.style.backgroundColor = bg;
      }
      // Windows: pad right so fit addon leaves room for the scrollbar.
      if (this.terminal.element && window.electronAPI.getPlatform() === 'win32') {
        this.terminal.element.style.paddingRight = '24px';
      }
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

    // Resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver((entries) => {
      this.fitScheduler.onResize(entries[0]?.contentRect?.height ?? 0);
    });
    this.resizeObserver.observe(container);

    // Reset per attach — only a fresh shell spawn below re-arms the ghost, so
    // a reattach (which already has real content) never clears the screen.
    this.placeholderActive = false;

    // Start PTY if not started (first attach)
    let reattached = false;
    let isDirectSpawn = false;
    // A fresh shell spawn with nothing to restore gets the dim `folder $` ghost.
    let showShellPlaceholder = false;
    if (!this.ptyStarted) {
      // Buffer PTY data while we start the process and restore the snapshot.
      // connectPtyListeners() checks dataBuffer and pushes into it instead
      // of writing directly to the terminal. We flush after setup completes.
      this.dataBuffer = [];
      this.connectPtyListeners();

      // Size the grid to the pane before spawning so the PTY's initial cols
      // match the visible width. Otherwise the process spawns against xterm's
      // default 80 cols and visibly reflows once the first rAF fit lands.
      const initDims = this.proposeDims();
      if (initDims && initDims.cols > 0 && initDims.rows > 0) {
        this.terminal.resize(initDims.cols, initDims.rows);
      }

      if (this.shellOnly) {
        // TUI tabs are backed by a PTY that main spawned via startCommandPty
        // (Clack side-car). If the user reaches this attach path and no PTY
        // exists for the id, the orchestrator/side-car died — falling back to
        // a shell would silently hide the failure behind a plausible-looking
        // prompt. Render an error line and bail instead.
        if (this.isTui) {
          // Service tab ids are `service:<taskId>:<addonId>:<key>`.
          const taskIdGuess = this.id.split(':')[1] ?? '';
          const targets = await window.electronAPI.ptyListForTask(taskIdGuess, {
            kinds: ['service'],
          });
          const exists = targets.success && targets.data && targets.data.includes(this.id);
          if (!exists) {
            this.terminal.write(
              clackBlock(
                'error',
                'Backing process not running for this tab.',
                'Start it again from its drawer.',
              ),
            );
            this.ptyStarted = true;
            return;
          }
        }

        // Shell-only mode: just spawn a shell, skip Claude CLI
        let existingSnapshot: TerminalSnapshot | null = null;
        try {
          const snapshotResp = await window.electronAPI.ptyGetSnapshot(this.id);
          if (snapshotResp.success && snapshotResp.data) {
            existingSnapshot = snapshotResp.data;
          }
        } catch (err) {
          // Snapshot fetch via IPC: legitimate "no snapshot" arrives as a
          // success with empty data, so reaching the catch means IPC itself
          // misbehaved — log so a permanently broken bridge is debuggable.
          console.warn('[terminal] ptyGetSnapshot failed:', err);
        }
        if (gen !== this.attachGeneration) return;

        const dims = this.proposeDims();
        let shellResp = await window.electronAPI.ptyStart({
          id: this.id,
          cwd: this.cwd,
          cols: this.ptyCols(dims?.cols ?? 120),
          rows: dims?.rows ?? 30,
        });
        if (gen !== this.attachGeneration) return;
        reattached = shellResp.data?.reattached ?? false;

        // Self-heal: a buggy earlier `restart()` (pre-shellOnly branch)
        // could have spawned Claude into this shell-mode PTY id. ptyStart
        // reattaches blindly, so without this we'd render Claude's TUI in
        // the drawer. Kill the stray and respawn as a real shell. The
        // snapshot is also discarded — it's from the Claude session and
        // would replay garbled into a shell terminal.
        if (reattached && shellResp.data?.isDirectSpawn) {
          console.warn(
            `[terminal] stray direct-spawn at shell id ${this.id} — killing and respawning as shell`,
          );
          window.electronAPI.ptyKill(this.id);
          existingSnapshot = null;
          await new Promise((r) => setTimeout(r, 50));
          shellResp = await window.electronAPI.ptyStart({
            id: this.id,
            cwd: this.cwd,
            cols: this.ptyCols(dims?.cols ?? 120),
            rows: dims?.rows ?? 30,
          });
          if (gen !== this.attachGeneration) return;
          reattached = shellResp.data?.reattached ?? false;
        }
        this.ptyStarted = true;

        // Reattach: restore from the main-process mirror — authoritative,
        // includes output emitted while no renderer was attached, and fixes
        // the blank idle shell after reload (a shell never repaints its
        // prompt unprompted). Fresh spawn: replay the persisted file
        // snapshot (app-restart restore) — unless it holds nothing but an
        // idle prompt: the new shell prints its own, and replaying would
        // stack a duplicate.
        // The shell prompt's first line is the cwd basename — pass it so a
        // bare `<folder>\n$ ` snapshot is recognized as prompt-only and not
        // replayed under the fresh shell's own prompt (which would duplicate).
        const promptLabel = this.cwd.split('/').filter(Boolean).pop() ?? this.cwd;
        const snapshotData =
          existingSnapshot?.data && !isPromptOnlySnapshot(existingSnapshot.data, promptLabel)
            ? existingSnapshot.data
            : null;
        const restoreData = reattached ? (shellResp.data?.serializedState ?? null) : snapshotData;
        // Fresh spawn, nothing replayed → blank for ~1.5s of dotfile init. Arm
        // the ghost prompt (painted in the rAF below, once the grid is sized).
        showShellPlaceholder = !reattached && !restoreData;
        if (restoreData) {
          try {
            this.terminal.write(restoreData);
            // Fresh spawn under replayed content: park the cursor at col 0
            // so the incoming shell's PROMPT_SP mark (%) overwrites itself
            // instead of smearing onto the restored last line.
            if (!reattached) this.terminal.write('\r\n');
          } catch (err) {
            // xterm rejected the buffered bytes — usually a corrupt or
            // malformed control sequence in the snapshot. Without logging,
            // the user just sees a half-rendered terminal with no clue why.
            console.warn('[terminal] writing restored state to xterm failed:', err);
          }
        }
      } else {
        // Claude Code mode: main finds (or dispatches) the task's session under
        // Claude Code's supervisor and spawns a `claude attach` client into
        // this PTY. The client repaints the whole screen on attach, so there is
        // no snapshot or mirror state to restore — a renderer reload simply
        // attaches again.
        this.setDetached(null);
        const result = await this.startPty();
        if (gen !== this.attachGeneration) return;
        isDirectSpawn = result.isDirectSpawn;
      }
    }

    {
      // Hide xterm's real cursor for direct spawns — Ink renders its own
      // character cursor in the input field; xterm's cursor just blinks
      // at the wrong position (end of buffer). Skip for shell-only.
      if (isDirectSpawn && !this.shellOnly) {
        this.terminal.write('\x1b[?25l');
      }

      // If we buffered PTY data during startup, flush it now that the
      // snapshot has been restored and the terminal is ready.
      if (this.dataBuffer !== null) {
        const buffered = this.dataBuffer;
        this.dataBuffer = null;
        for (const chunk of buffered) {
          this.terminal.write(chunk);
        }
      }

      // Re-attach path: listeners weren't set up above, connect them now
      if (!this.unsubData) {
        this.connectPtyListeners();
      }

      requestAnimationFrame(() => {
        if (gen !== this.attachGeneration) return;
        // Disable focus reporting before focusing — a restored snapshot or
        // previous Ink process may have left it enabled, and the focus event
        // would send \x1b[I as PTY input before the new Ink process is ready,
        // causing stray "O"/"I" chars in the input field.
        this.terminal.write('\x1b[?1004l');
        // fitTerminal() sizes the xterm grid + syncs the PTY in one place.
        this.fitTerminal();
        if (opts?.autoFocus !== false) {
          this.terminal.focus();
        }

        // Paint the dim `folder` / `$` ghost now that the grid is sized. Mirrors
        // the two-line zsh prompt (folder name, then `$` on the next line) so the
        // real prompt lands in the same spot — the wipe-on-first-data below makes
        // the swap seamless.
        if (showShellPlaceholder) {
          const folder = this.cwd.split('/').filter(Boolean).pop() ?? this.cwd;
          this.terminal.write(`\x1b[2m${folder}\r\n$ \x1b[0m`);
          this.placeholderActive = true;
        }

        if (this.savedViewportY !== null) {
          this.forceScrollToLine(this.savedViewportY);
          this.savedViewportY = null;
        }
      });
    }
  }

  /**
   * Re-link to a backing PTY that main just respawned under the same id
   * (service Run-again). Unlike dispose(), this does NOT kill the PTY — main
   * already started the new process. It drops the stale data/exit listeners,
   * wipes the dead run's output, and re-runs attach() so ptyStart reattaches
   * to the new process (claiming ownership + replaying its mirror). Without
   * this, the cached session keeps ptyStarted=true and never reconnects, so a
   * live service renders a blank terminal.
   */
  async resetForRespawn(): Promise<void> {
    if (this.disposed) return;
    if (this.unsubData) {
      this.unsubData();
      this.unsubData = null;
    }
    if (this.unsubExit) {
      this.unsubExit();
      this.unsubExit = null;
    }
    this.dataBuffer = null;
    this.ptyStarted = false;
    this.resetTerminal();
    if (this.currentContainer) {
      await this.attach(this.currentContainer, { autoFocus: true });
    }
  }

  detach() {
    this.savedViewportY = this.terminal.buffer.active.viewportY;

    // Stop timers
    if (this.readyFallbackTimer) {
      clearTimeout(this.readyFallbackTimer);
      this.readyFallbackTimer = null;
    }
    this.fitScheduler.cancel();

    // Clear callbacks to prevent stale setState on unmounted components
    this.onRestartingCallback = null;
    this.onDetachedCallback = null;
    this.onReadyCallback = null;
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

    this.fitScheduler.cancel();
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

  /**
   * Agent panes: called with the exit info when the attach client exits and
   * the pane shows the Detached card, and with null when a (re)attach starts.
   */
  onDetached(cb: ((info: { exitCode: number } | null) => void) | null) {
    this.onDetachedCallback = cb;
    if (cb) cb(this.detachedInfo);
  }

  get isDetached(): boolean {
    return this.detachedInfo !== null;
  }

  private setDetached(info: { exitCode: number } | null) {
    this.detachedInfo = info;
    this.onDetachedCallback?.(info);
  }

  /** Re-attach after a detach (Detached card → Re-attach). */
  async reattach(): Promise<void> {
    if (this.disposed || !this.currentContainer || this.ptyStarted) return;
    this.dataBuffer = null;
    await this.attach(this.currentContainer, { autoFocus: true });
  }

  /**
   * User-initiated restart — kill the current PTY and respawn fresh so the
   * new process inherits whatever env vars / settings have changed since
   * the original spawn. Used by the port-management flow to pick up newly
   * allocated env vars without losing the Claude session (the main process
   * re-spawns with `claude --continue`).
   *
   * Branches on shellOnly because `restartAllForTask` blindly iterates
   * every PTY associated with the task — agent (taskId) + drawer shells
   * (shell:taskId, shell:taskId:*). Without the branch we'd call
   * ptyStartDirect on the shell-mode sessions and spawn Claude inside the
   * shell drawer's PTY ID, leaving the drawer mirroring the agent's CC
   * session after the next refresh.
   *
   * Tears down the existing listeners before kill so the onPtyExit
   * shell-fallback path doesn't fire — we want a clean re-spawn, not the
   * "process died, give me a shell" recovery.
   */
  async restart(): Promise<void> {
    if (this.disposed) return;
    this._isRestarting = true;
    this.readyFired = false;
    this.onRestartingCallback?.();
    this.dataBuffer = [];

    if (this.unsubExit) {
      this.unsubExit();
      this.unsubExit = null;
    }
    if (this.unsubData) {
      this.unsubData();
      this.unsubData = null;
    }

    if (this.shellOnly) {
      // Await the graceful kill: main drops the PTY record synchronously and
      // then waits for the child to exit, so the respawn below spawns fresh.
      await window.electronAPI.ptyKillAwait(this.id);
      this.ptyStarted = false;
      const dims = this.proposeDims();
      await window.electronAPI.ptyStart({
        id: this.id,
        cwd: this.cwd,
        cols: this.ptyCols(dims?.cols ?? 120),
        rows: dims?.rows ?? 30,
      });
      this.ptyStarted = true;
    } else {
      // Agent pane: a restart is a re-dispatch. Main kills the attach client,
      // stops and forgets the supervisor job, and the attach below starts a
      // fresh job that resumes the same session id with a fresh environment.
      // A foreign session only gets a fresh attach client.
      if (!foreignSessionJobId(this.id)) {
        await window.electronAPI.ptyRestartSession(this.id);
      } else {
        await window.electronAPI.ptyKillAwait(this.id);
      }
      this.ptyStarted = false;
      this.resetTerminal();
      this.setDetached(null);
      await this.startPty();
    }
    this.connectPtyListeners();

    // Flush + stop buffering. We set dataBuffer = [] at the top to absorb
    // any in-flight bytes during the kill/respawn window, but if we leave
    // it non-null, onPtyData keeps pushing into it forever and never
    // writes to xterm — the terminal looks frozen until the next attach()
    // (e.g. on task switch) hits its own flush path. Mirrors attach().
    if (this.dataBuffer !== null) {
      const buffered = this.dataBuffer;
      this.dataBuffer = null;
      for (const chunk of buffered) {
        this.terminal.write(chunk);
      }
    }

    if (this.readyFallbackTimer) clearTimeout(this.readyFallbackTimer);
    this.readyFallbackTimer = setTimeout(() => {
      this.fireReady();
    }, 10_000);
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

  /**
   * Columns/rows that fill the padded content box — like FitAddon's
   * proposeDimensions, but WITHOUT subtracting a fixed scrollbar reserve.
   * FitAddon reserves `viewport.scrollBarWidth` (~15-19px) on the right for a
   * scrollbar we hide entirely (and that Claude's NO_FLICKER mode never uses),
   * which left the grid short of the right edge — a lopsided gutter. We measure
   * the same cell size FitAddon uses and divide the `.xterm` element's real
   * content box (clientWidth, which already subtracts any actual scrollbar) by
   * it. Falls back to FitAddon if xterm's internal render metrics ever move.
   */
  private proposeDims(): { cols: number; rows: number } | undefined {
    const el = this.terminal.element;
    const cell = (
      this.terminal as unknown as {
        _core?: {
          _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } };
        };
      }
    )._core?._renderService?.dimensions?.css?.cell;
    if (!el || !cell?.width || !cell?.height) {
      return this.fitAddon.proposeDimensions();
    }
    // Measure the `.xterm` element's OWN content box via clientWidth/Height
    // (not the parent's computed width): clientWidth subtracts any ancestor
    // scrollbar that the element doesn't actually get to paint into, whereas
    // getComputedStyle().width does not. Using the parent width over-measured
    // by the scrollbar's ~16px, handing out columns that don't fit — invisible
    // under WebGL (it clips) but a visible right-edge overlap under the DOM
    // renderer. clientWidth already includes padding, so subtract it back out.
    const es = window.getComputedStyle(el);
    const availW =
      el.clientWidth -
      (parseInt(es.getPropertyValue('padding-left')) +
        parseInt(es.getPropertyValue('padding-right')));
    const availH =
      el.clientHeight -
      (parseInt(es.getPropertyValue('padding-top')) +
        parseInt(es.getPropertyValue('padding-bottom')));
    // A hidden / not-yet-laid-out element has clientWidth/Height 0, so availW/H
    // go non-positive. Bail to undefined so the resize is skipped (rather than
    // shipping a squashed grid) until the layout settles.
    if (!Number.isFinite(availW) || !Number.isFinite(availH) || availW <= 0 || availH <= 0) {
      return undefined;
    }
    // Shell-only (DOM renderer) lays glyphs wider than `cell.width`; once we've
    // measured the real advance, size columns against it so the grid fits.
    const colWidth = this.shellOnly && this.domCellWidth ? this.domCellWidth : cell.width;
    return {
      cols: Math.max(2, Math.floor(availW / colWidth)),
      rows: Math.max(1, Math.floor(availH / cell.height)),
    };
  }

  /**
   * Read the DOM renderer's actual per-column advance from a rendered row and
   * cache it in `domCellWidth`. xterm's reported `css.cell.width` under-counts
   * the real glyph advance, so rows render wider than the grid xterm sizes and
   * the last glyph spills past the right padding. When the measured advance
   * changes the answer, re-fit once so the corrected column count takes effect;
   * a stable measurement (within 0.05px) is a no-op, so this converges. No-op
   * for WebGL terminals, whose grid is pixel-snapped to the cell.
   */
  private measureDomCellWidth(): void {
    if (!this.shellOnly) return;
    const el = this.terminal.element;
    requestAnimationFrame(() => {
      const row = el?.querySelector('.xterm-rows > div') as HTMLElement | null;
      const renderedCols = this.terminal.cols;
      if (!row || renderedCols <= 0) return;
      const advance = row.scrollWidth / renderedCols;
      // Ignore bogus reads during layout transitions (collapsed/empty rows).
      if (!Number.isFinite(advance) || advance <= 0) return;
      const prev = this.domCellWidth;
      if (prev !== undefined && Math.abs(prev - advance) < 0.05) return;
      this.domCellWidth = advance;
      this.fit();
    });
  }

  getSearchAddon(): SearchAddon {
    return this.searchAddon;
  }

  setOnFindKey(cb: (() => void) | null): void {
    this.onFindKey = cb;
  }

  get currentCwd(): string {
    return this._currentCwd;
  }

  onCwdChange(cb: ((cwd: string) => void) | null) {
    this.onCwdChangeCallback = cb;
  }

  setTheme(isDark: boolean) {
    this.setTerminalTheme(this.themeId, isDark);
  }

  /**
   * Shell-only sessions render with a transparent xterm canvas so the floating
   * right-pane glass shows through. Paired with `allowTransparency: true` on
   * the Terminal constructor.
   */
  private effectiveTheme(theme: ITheme): ITheme {
    if (!this.shellOnly) return theme;
    return { ...theme, background: 'rgba(0,0,0,0)' };
  }

  setTerminalTheme(themeId: string, isDark: boolean) {
    this.themeId = themeId;
    this.isDark = isDark;
    const theme = this.effectiveTheme(resolveTheme(themeId, isDark));
    try {
      this.terminal.options.theme = theme;
    } catch {
      // WebGL addon may crash if GPU context is lost (e.g. hidden terminal).
      // Re-apply after reloading the addon on next attach.
    }

    // Sync .xterm background so padding gutters match the theme
    if (this.terminal.element && theme.background) {
      this.terminal.element.style.backgroundColor = theme.background;
    }

    // Trigger SIGWINCH so the TUI redraws with the new ANSI palette.
    // rows+1 then rows forces the PTY process to handle SIGWINCH.
    if (this.ptyStarted && this.opened) {
      const dims = this.proposeDims();
      if (dims) {
        const cols = this.ptyCols(dims.cols);
        window.electronAPI.ptyResize({ id: this.id, cols, rows: dims.rows + 1 });
        setTimeout(() => {
          window.electronAPI.ptyResize({ id: this.id, cols, rows: dims.rows });
        }, 50);
      }
    }
  }

  setTerminalFont(fontFamily: string) {
    this.terminal.options.fontFamily = fontFamily;
    // Cell metrics change when the font does; refit so the grid + PTY row/col
    // dimensions match the new glyph size.
    try {
      this.fitTerminal();
    } catch {
      // Fit can throw if the terminal isn't attached yet; safe to ignore —
      // the next attach() will fit anyway.
    }
  }

  /**
   * Columns handed to the PTY. We give it the full xterm grid width — no
   * right-side reserve. The reserve existed to keep the old DOM renderer from
   * clipping the last glyph, but Dash now renders via WebGL (no clip), hides
   * the scrollbar entirely, and runs Claude Code with CLAUDE_CODE_NO_FLICKER=1
   * (it manages its own scrolling, so the xterm scrollbar is never used). A
   * reserve now just leaves dead space on the right.
   */
  private ptyCols(cols: number): number {
    return Math.max(1, cols);
  }

  /**
   * Size the xterm grid to the container and sync the PTY — the single place
   * both attach() and the resize observer route through. FitAddon already
   * subtracts the `.xterm` padding (the gutter) when proposing columns, so the
   * grid fits with an even margin on both sides; no extra reserve is needed.
   */
  private fitTerminal(): void {
    const dims = this.proposeDims();
    if (
      !dims ||
      !Number.isFinite(dims.cols) ||
      !Number.isFinite(dims.rows) ||
      dims.cols <= 0 ||
      dims.rows <= 0
    )
      return;
    if (this.terminal.cols !== dims.cols || this.terminal.rows !== dims.rows) {
      this.terminal.resize(dims.cols, dims.rows);
    }
    // Measure the DOM renderer's real glyph advance and re-fit if it differs
    // from what we sized with — see `domCellWidth`. The first fit sizes with
    // the under-reported cell width, this reads the actual rendered width, and
    // the follow-up fit lands the column count that fits the padded box.
    this.measureDomCellWidth();
    const cols = this.ptyCols(dims.cols);
    // Skip redundant PTY resizes to avoid SIGWINCH prompt redraw
    if (cols === this.lastPtyCols && dims.rows === this.lastPtyRows) return;
    this.lastPtyCols = cols;
    this.lastPtyRows = dims.rows;
    window.electronAPI.ptyResize({ id: this.id, cols, rows: dims.rows });
  }

  private fit() {
    try {
      // Never fit against a hidden container — FitAddon clamps to a 1-row
      // minimum, which would squash the PTY and desync the shell's prompt
      const containerEl = this.terminal.element?.parentElement;
      if (containerEl && containerEl.clientHeight < 10) return;
      this.fitTerminal();
    } catch {
      // Ignore fit errors during transitions
    }
  }

  private async startPty(): Promise<{
    reattached: boolean;
    isDirectSpawn: boolean;
  }> {
    const dims = this.proposeDims();
    const cols = this.ptyCols(dims?.cols ?? 120);
    const rows = dims?.rows ?? 30;

    // A foreign session (started outside Dash) is attached by job id; a task
    // pane is started by task id and main resolves the job.
    const foreignJobId = foreignSessionJobId(this.id);
    const resp = foreignJobId
      ? await window.electronAPI.sessionAttach({
          jobId: foreignJobId,
          cwd: this.cwd,
          cols,
          rows,
          isDark: this.isDark,
        })
      : await window.electronAPI.ptyStartDirect({
          id: this.id,
          cwd: this.cwd,
          cols,
          rows,
          permissionMode: this.permissionMode,
          isDark: this.isDark,
        });

    let isDirectSpawn = true;
    if (!resp.success) {
      isDirectSpawn = false;
      const isNativeModuleError = resp.error?.includes('[native module]');
      if (resp.code === 'UNSUPPORTED_CLI') {
        // Missing or too-old Claude Code. MainContent normally renders the
        // ClaudeCliGate panel instead of mounting this terminal at all; if we
        // still got here, say why and stay put — a shell in the task pane
        // would hide the real problem.
        this.terminal.write(
          clackBlock('error', 'Cannot start the task session.', resp.error ?? 'Unsupported CLI'),
        );
      } else if (isNativeModuleError) {
        this.terminal.write(
          clackBlock(
            'error',
            'Terminal failed to start: native module error.',
            'Rebuild native modules with: pnpm rebuild',
            ...(resp.error ? [resp.error] : []),
          ),
        );
      } else {
        // Dispatch or attach failed (supervisor refused, CLI missing). No
        // shell fallback: the pane belongs to the session, and a shell here
        // would hide the failure behind a working prompt.
        this.terminal.write(
          clackBlock(
            'error',
            'Could not start the Claude session.',
            ...(resp.error ? [resp.error] : []),
            'Use Restart in the task menu to try again.',
          ),
        );
      }
    }

    this.ptyStarted = true;

    return { reattached: false, isDirectSpawn };
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

      // Real shell output has arrived — wipe the `folder $` ghost (screen +
      // scrollback) so the shell's own prompt replaces it cleanly, not below it.
      if (this.placeholderActive) {
        this.placeholderActive = false;
        this.terminal.write('\x1b[2J\x1b[3J\x1b[H');
      }

      this.terminal.write(data);
      this.checkMemory();
    });

    // Listen for PTY exit → detached card (agent panes), shell fallback
    // (shell tabs) or a message (main-spawned tabs).
    this.unsubExit = window.electronAPI.onPtyExit(this.id, (info) => {
      if (this.disposed) return;

      // Ensure PTY is cleaned up in main process
      window.electronAPI.ptyKill(this.id);

      const fallback = ptyExitFallback(this.id, this.isTui, this.shellOnly);
      if (fallback.action === 'detached') {
        // The `claude attach` client exited (Esc out of agent view, Ctrl+Z,
        // or the session process went away); the session itself lives on
        // under the supervisor. Leave the alternate screen and mouse modes
        // the client enabled so the pane is a plain terminal again, then
        // hand the pane to the Detached card (TerminalPane).
        this.ptyStarted = false;
        this.resetTerminal();
        this.setDetached({ exitCode: info.exitCode });
        return;
      }
      if (fallback.action === 'message') {
        this.terminal.write(clackExitBlock(info.exitCode, fallback.message));
        return;
      }
      this.terminal.write(clackExitBlock(info.exitCode));

      // Show xterm's real cursor for the shell fallback
      this.terminal.write('\x1b[?25h');

      const dims = this.proposeDims();
      void window.electronAPI
        .ptyStart({
          id: this.id,
          cwd: this.cwd,
          cols: this.ptyCols(dims?.cols ?? 120),
          rows: dims?.rows ?? 30,
        })
        .then(() => {
          this.connectPtyListeners();
        });
    });
  }

  private async restoreSnapshot(): Promise<boolean> {
    try {
      const resp = await window.electronAPI.ptyGetSnapshot(this.id);
      if (resp.success && resp.data && resp.data.data) {
        this.terminal.write(resp.data.data);
        return true;
      }
    } catch (err) {
      console.warn('[terminal] restoreSnapshot failed:', err);
    }
    return false;
  }

  /**
   * scrollToLine(n) is a no-op when viewportY already equals n — xterm skips
   * the scroll event so the Viewport never syncs the DOM scrollTop. After a
   * DOM re-attach (appendChild), scrollTop resets to 0 but viewportY keeps its
   * old value, leaving them desynced. Force the event by scrolling away first.
   */
  private forceScrollToLine(line: number) {
    const buf = this.terminal.buffer.active;
    if (buf.viewportY === line) {
      this.terminal.scrollToLine(line > 0 ? line - 1 : line + 1);
    }
    this.terminal.scrollToLine(line);
  }

  /**
   * Relieve renderer memory pressure by trimming THIS terminal's scrollback when
   * the heap runs genuinely high. Throttled (never per output chunk) and
   * non-destructive: lowering the scrollback cap drops the oldest off-screen
   * lines WITHOUT clearing the visible viewport, so it frees memory with no
   * repaint, and the reduced cap is sticky so it doesn't re-fire on the next
   * chunk.
   *
   * The previous version called `terminal.clear()` on every chunk once over a
   * 128MB limit and immediately restored scrollback to 100k — so with a normal
   * (Monaco-loaded) heap parked above 128MB it wiped + repainted the TUI on
   * every output chunk, flickering "like crazy" while output streamed (e.g. the
   * repaints Claude Code emits while scrolling in NO_FLICKER mode).
   */
  private checkMemory() {
    if (typeof performance === 'undefined' || !('memory' in performance)) return;
    const now = Date.now();
    if (now - this.lastMemoryCheckAt < MEMORY_CHECK_INTERVAL_MS) return;
    this.lastMemoryCheckAt = now;
    const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
    if (mem.usedJSHeapSize <= MEMORY_LIMIT_BYTES) return;
    const current = this.terminal.options.scrollback ?? MIN_SCROLLBACK;
    if (current <= MIN_SCROLLBACK) return; // already at the floor
    // Halve toward the floor; lowering the cap trims the oldest scrollback lines
    // in place — no clear(), no viewport repaint.
    this.terminal.options.scrollback = Math.max(MIN_SCROLLBACK, Math.floor(current / 2));
  }
}
