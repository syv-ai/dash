import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { Utf8Base64 } from './clipboardCodec';
import type { PermissionMode, TerminalSnapshot } from '../../shared/types';
import { FilePathLinkProvider } from './FilePathLinkProvider';
import type { ITheme } from 'xterm';
import { darkTheme, lightTheme, resolveTheme } from './terminalThemes';
import { getTerminalFont } from './terminalFonts';
import { ptyExitFallback } from './ptyExitFallback';
import { clackBlock, clackExitBlock } from './clackLines';
import { isPromptOnlySnapshot } from './snapshotFilter';
import { FitScheduler } from './fitScheduler';
import { TUI_COLS, TUI_ROWS } from '../../shared/tuiProtocol';

const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024; // 128MB soft limit

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
  private onReadyCallback: (() => void) | null = null;
  private readyFired = false;
  private readyFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private _currentCwd: string;
  private onCwdChangeCallback: ((cwd: string) => void) | null = null;
  private onFindKey: (() => void) | null = null;
  // 250ms debounce covers panel-transition animations (200ms) to avoid
  // fitting at intermediate sizes; cancels itself when the container hides
  private fitScheduler = new FitScheduler(() => this.fit(), 250);
  private lastPtyCols = 0;
  private lastPtyRows = 0;
  private savedViewportY: number | null = null;
  readonly shellOnly: boolean;
  readonly isTui: boolean;
  /**
   * Side-car clack TUIs (`tui:` ids) render on a fixed TUI_COLS×TUI_ROWS
   * canvas — clack never repaints on resize, so these sessions are exempt
   * from all fitting. Service tabs share isTui for attach purposes but stay
   * fully fitted.
   */
  private readonly pinnedTui: boolean;
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
    this.pinnedTui = this.isTui && opts.id.startsWith('tui:');
    this.themeId = opts.themeId ?? 'default';

    this.terminal = new Terminal({
      scrollback: 100_000,
      // Pinned clack TUIs are a compact dialog, not a code terminal — match
      // the app's chrome size so they don't read oversized.
      fontSize: this.pinnedTui ? 11 : 13,
      fontFamily: getTerminalFont(),
      lineHeight: 1.2,
      allowProposedApi: true,
      // Shell-only sessions sit on the floating right-pane glass — render
      // with alpha so the frosted background shows through xterm's canvas.
      allowTransparency: this.shellOnly,
      theme: this.effectiveTheme(resolveTheme(this.themeId, this.isDark)),
      // Pinned TUIs are non-interactive; no blinking xterm caret.
      cursorBlink: !this.pinnedTui,
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

  private async loadGpuAddon() {
    // On Linux, WebGL has compositing bugs that cause the terminal canvas to
    // go blank when content updates (typing, output). Skip straight to Canvas.
    const isLinux = navigator.userAgent.includes('Linux');

    if (!isLinux) {
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          void this.loadGpuAddon();
        });
        this.terminal.loadAddon(webgl);
        return;
      } catch {
        // Fall through to canvas
      }
    }

    try {
      const { CanvasAddon } = await import('@xterm/addon-canvas');
      this.terminal.loadAddon(new CanvasAddon());
    } catch {
      // Software renderer fallback
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
      // TUI sessions render on a fixed canvas: clack paints a frame at the
      // dims it sees and never repaints on resize, so the xterm is pinned to
      // the side-car's spawn dims and exempted from all fitting below.
      if (this.pinnedTui) {
        this.terminal.resize(TUI_COLS, TUI_ROWS);
      }
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

    // Start PTY if not started (first attach)
    let reattached = false;
    let isDirectSpawn = false;
    if (!this.ptyStarted) {
      // Buffer PTY data while we start the process and restore the snapshot.
      // connectPtyListeners() checks dataBuffer and pushes into it instead
      // of writing directly to the terminal. We flush after setup completes.
      this.dataBuffer = [];
      this.connectPtyListeners();

      if (this.shellOnly) {
        // TUI tabs are backed by a PTY that main spawned via startCommandPty
        // (Clack side-car). If the user reaches this attach path and no PTY
        // exists for the id, the orchestrator/side-car died — falling back to
        // a shell would silently hide the failure behind a plausible-looking
        // prompt. Render an error line and bail instead.
        if (this.isTui) {
          // Extract the taskId from the tab id. Chassis TUI tabs are
          // `tui:<featureId>:<taskId>`; service tabs are
          // `service:<taskId>:<slug>[:logs]`; legacy shapes were
          // `<feature>-tui:<taskId>`.
          const parts = this.id.split(':');
          const taskIdGuess = this.id.startsWith('tui:') ? (parts[2] ?? '') : (parts[1] ?? '');
          const targets = await window.electronAPI.ptyListForTask(taskIdGuess, {
            kinds: ['tui', 'service'],
          });
          const exists = targets.success && targets.data && targets.data.includes(this.id);
          if (!exists) {
            this.terminal.write(
              clackBlock(
                'error',
                'Backing process not running for this tab.',
                'For a service tab, press Run in the Ports panel to start it again.',
                'For a Dash TUI tab, close it and re-open the task.',
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

        const dims = this.fitAddon.proposeDimensions();
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
        const snapshotData =
          existingSnapshot?.data && !isPromptOnlySnapshot(existingSnapshot.data)
            ? existingSnapshot.data
            : null;
        const restoreData = reattached ? (shellResp.data?.serializedState ?? null) : snapshotData;
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
        // Claude Code mode: try direct spawn, fall back to shell.
        // Main process decides whether to resume (by checking if this task's
        // own Claude session file exists) — renderer no longer gates on it.
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

        let result = await this.startPty();
        if (gen !== this.attachGeneration) return;

        // If we reattached to an existing direct-spawn PTY (e.g. after CMD+R),
        // kill it and spawn fresh. Ink's internal cursor state can't be
        // recovered via SIGWINCH, but a fresh Claude Code process with `-r`
        // pointed at this task's session file gives a clean TUI init.
        let mirrorState: string | null = null;
        if (result.reattached && result.isDirectSpawn) {
          // The old PTY's mirror state is fresher than the file snapshot —
          // keep it for the context write below before killing the PTY.
          mirrorState = result.serializedState ?? null;
          this._isRestarting = true;
          this.readyFired = false;
          this.onRestartingCallback?.();
          // Discard any data buffered from the old PTY before killing it
          this.dataBuffer = [];
          // Await the graceful kill (SIGTERM → flush → exit) before respawning
          // so the fresh `claude --resume` doesn't race the dying process for
          // the session jsonl. The map record is dropped synchronously in main,
          // so the respawn below spawns fresh rather than reattaching.
          await window.electronAPI.ptyKillAwait(this.id);
          if (gen !== this.attachGeneration) return;
          this.ptyStarted = false;
          result = await this.startPty();
          if (gen !== this.attachGeneration) return;

          // Fallback: hide overlay after 10s even if no data arrives
          this.readyFallbackTimer = setTimeout(() => {
            this.fireReady();
          }, 10_000);
        }

        isDirectSpawn = result.isDirectSpawn;

        // Show previous content for visual context while Claude starts —
        // mirror state when we just recycled a live PTY, file snapshot on a
        // cold start.
        const restoreData =
          mirrorState ?? (!result.reattached ? (existingSnapshot?.data ?? null) : null);
        if (restoreData) {
          try {
            this.terminal.write(restoreData);
          } catch (err) {
            // xterm rejected the buffered bytes — usually a corrupt or
            // malformed control sequence in the snapshot. Without logging,
            // the user just sees a half-rendered terminal with no clue why.
            console.warn('[terminal] writing restored state to xterm failed:', err);
          }
        }
      }
    }

    {
      // Hide xterm's real cursor for direct spawns — Ink renders its own
      // character cursor in the input field; xterm's cursor just blinks
      // at the wrong position (end of buffer). Skip for shell-only.
      // Pinned TUIs are non-interactive: clack draws its own caret, so xterm's
      // would just blink in the empty row below the frame.
      if ((isDirectSpawn && !this.shellOnly) || this.pinnedTui) {
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
        // TUI sessions keep their pinned canvas — fitting here mid-drawer
        // animation shrank the PTY to transitional dims and the side-car's
        // clack frame (which never repaints on resize) rendered garbled.
        if (!this.pinnedTui) this.fitAddon.fit();
        if (opts?.autoFocus !== false) {
          this.terminal.focus();
        }

        if (this.savedViewportY !== null) {
          this.forceScrollToLine(this.savedViewportY);
          this.savedViewportY = null;
        }

        if (this.pinnedTui) return;
        // Use fit() dedup logic — avoid redundant SIGWINCH that can cause
        // the shell to redraw while the user is already typing
        const dims = this.fitAddon.proposeDimensions();
        if (!dims) return;
        const cols = this.ptyCols(dims.cols);
        if (cols !== this.lastPtyCols || dims.rows !== this.lastPtyRows) {
          this.lastPtyCols = cols;
          this.lastPtyRows = dims.rows;
          window.electronAPI.ptyResize({
            id: this.id,
            cols,
            rows: dims.rows,
          });
        }
      });
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

    // Await the graceful kill: main drops the PTY record synchronously and
    // then waits for the child to flush + exit, so the respawn below spawns
    // fresh (no reattach race) and no session-jsonl tail is lost. Replaces the
    // old fire-and-forget kill + fixed 50ms settle.
    await window.electronAPI.ptyKillAwait(this.id);
    this.ptyStarted = false;

    if (this.shellOnly) {
      const dims = this.fitAddon.proposeDimensions();
      await window.electronAPI.ptyStart({
        id: this.id,
        cwd: this.cwd,
        cols: this.ptyCols(dims?.cols ?? 120),
        rows: dims?.rows ?? 30,
      });
      this.ptyStarted = true;
    } else {
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
   * CSS px width of the rendered grid — used to size the drawer panel to hug
   * a pinned TUI canvas (clack can't reflow, so the panel fits the canvas
   * rather than the reverse). 0 before the renderer has laid out.
   */
  getCanvasWidthPx(): number {
    const screen = this.terminal.element?.querySelector('.xterm-screen') as HTMLElement | null;
    return screen?.offsetWidth ?? 0;
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
    // rows+1 then rows forces the PTY process to handle SIGWINCH. Skipped
    // for pinned TUI sessions — clack uses ANSI-16 colors, which xterm
    // re-themes without a repaint.
    if (this.ptyStarted && this.opened && !this.pinnedTui) {
      const dims = this.fitAddon.proposeDimensions();
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
    // Cell metrics change when the font does; refit so the PTY's row/col
    // dimensions match the new glyph size.
    try {
      this.fitAddon.fit();
    } catch {
      // Fit can throw if the terminal isn't attached yet; safe to ignore —
      // the next attach() will fit anyway.
    }
  }

  /** Reserve columns so the TUI doesn't render into the right edge. */
  private static readonly COL_RESERVE = 5;
  private static readonly COL_RESERVE_SHELL = 1;

  /** Reduce cols for PTY so the TUI leaves a right-side gutter. */
  private ptyCols(cols: number): number {
    // Windows: no col reserve — Ink's cursor positioning drifts from xterm's
    // grid during streaming if PTY cols < xterm cols, producing garbled output.
    // Scrollbar clearance is handled by paddingRight on the .xterm element.
    if (window.electronAPI.getPlatform() === 'win32') {
      return Math.max(1, cols);
    }
    const reserve = this.shellOnly
      ? TerminalSessionManager.COL_RESERVE_SHELL
      : TerminalSessionManager.COL_RESERVE;
    return Math.max(1, cols - reserve);
  }

  private fit() {
    // TUI sessions are pinned to TUI_COLS×TUI_ROWS — never fit or resize.
    if (this.pinnedTui) return;
    try {
      // Never fit against a hidden container — FitAddon clamps to a 1-row
      // minimum, which would squash the PTY and desync the shell's prompt
      const containerEl = this.terminal.element?.parentElement;
      if (containerEl && containerEl.clientHeight < 10) return;
      this.fitAddon.fit();
      const dims = this.fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        const cols = this.ptyCols(dims.cols);
        // Skip redundant PTY resizes to avoid SIGWINCH prompt redraw
        if (cols === this.lastPtyCols && dims.rows === this.lastPtyRows) return;
        this.lastPtyCols = cols;
        this.lastPtyRows = dims.rows;
        window.electronAPI.ptyResize({
          id: this.id,
          cols,
          rows: dims.rows,
        });
      }
    } catch {
      // Ignore fit errors during transitions
    }
  }

  private async startPty(): Promise<{
    reattached: boolean;
    isDirectSpawn: boolean;
    serializedState?: string;
  }> {
    const dims = this.fitAddon.proposeDimensions();
    const cols = this.ptyCols(dims?.cols ?? 120);
    const rows = dims?.rows ?? 30;

    let reattached = false;
    let isDirectSpawn = false;
    let serializedState: string | undefined;
    const resp = await window.electronAPI.ptyStartDirect({
      id: this.id,
      cwd: this.cwd,
      cols,
      rows,
      permissionMode: this.permissionMode,
      isDark: this.isDark,
    });

    if (resp.success) {
      reattached = resp.data?.reattached ?? false;
      isDirectSpawn = resp.data?.isDirectSpawn ?? true;
      serializedState = resp.data?.serializedState;
    } else {
      const isNativeModuleError = resp.error?.includes('[native module]');

      if (isNativeModuleError) {
        // node-pty itself failed — shell fallback won't work either
        this.terminal.write(
          clackBlock(
            'error',
            'Terminal failed to start: native module error.',
            'Rebuild native modules with: pnpm rebuild',
            ...(resp.error ? [resp.error] : []),
          ),
        );
      } else {
        // Claude CLI not found — fall back to shell
        this.terminal.write(
          clackBlock(
            'warn',
            'Could not start Claude CLI directly — falling back to shell.',
            'Install with: npm install -g @anthropic-ai/claude-code',
          ),
        );

        const shellResp = await window.electronAPI.ptyStart({
          id: this.id,
          cwd: this.cwd,
          cols,
          rows,
        });

        if (shellResp.success) {
          reattached = shellResp.data?.reattached ?? false;
          isDirectSpawn = shellResp.data?.isDirectSpawn ?? false;
        } else {
          this.terminal.write(
            clackBlock(
              'error',
              'Shell also failed to start.',
              ...(shellResp.error ? [shellResp.error] : []),
            ),
          );
        }
      }
    }

    this.ptyStarted = true;

    return { reattached, isDirectSpawn, serializedState };
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
      this.checkMemory();
    });

    // Listen for PTY exit → spawn shell fallback (agent/shell tabs only)
    this.unsubExit = window.electronAPI.onPtyExit(this.id, (info) => {
      if (this.disposed) return;

      // Ensure PTY is cleaned up in main process
      window.electronAPI.ptyKill(this.id);

      const fallback = ptyExitFallback(this.id, this.isTui);
      if (fallback.action === 'message') {
        this.terminal.write(clackExitBlock(info.exitCode, fallback.message));
        return;
      }
      this.terminal.write(clackExitBlock(info.exitCode));

      // Show xterm's real cursor for the shell fallback
      this.terminal.write('\x1b[?25h');

      const dims = this.fitAddon.proposeDimensions();
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
