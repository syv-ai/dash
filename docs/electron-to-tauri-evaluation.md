# Electron → Tauri Migration Evaluation

**Date:** 2026-03-21
**Scope:** Architecture and product quality assessment for Dash

## Executive Summary

**Recommendation: Migrate to Tauri 2.**

Dash's architecture maps cleanly onto Tauri's model. The migration is non-trivial (~4-6 developer-weeks for a team comfortable with Rust) but delivers structural advantages that compound over the lifetime of the product: dramatically smaller binaries, lower memory footprint, better security posture, and a Rust backend that's a natural fit for the PTY/process management that sits at Dash's core. The main risk is the PTY layer—the rest is mechanical.

---

## Current Architecture Inventory

| Layer | Size | Key Dependencies |
|-------|------|-----------------|
| Main process (Rust target) | ~11,500 LOC TypeScript | node-pty, better-sqlite3, electron-updater, electron.safeStorage |
| Renderer (keeps as-is) | ~7,500 LOC TSX/TS | React 18, xterm.js, Tailwind CSS |
| IPC surface | 58 methods | 11 handler modules across app, db, pty, git, github, ado, autoupdate, telemetry |
| Native modules requiring rebuild | 3 | node-pty, better-sqlite3, @syv-ai/pixel-agents-watcher |

---

## Migration Mapping: What Changes, What Stays

### Stays the same (renderer)

The entire React/xterm.js frontend is preserved. Tauri serves the same Vite-built SPA. The only renderer change is swapping `window.electronAPI.method()` calls to `@tauri-apps/api` invoke/event calls—a mechanical find-and-replace against the 58-method `ElectronAPI` interface.

### Rewrites in Rust (main process → Tauri backend)

| Component | Electron (current) | Tauri (target) | Notes |
|-----------|-------------------|----------------|-------|
| **IPC handlers** | `ipcMain.handle()` in 11 TS files | `#[tauri::command]` functions | 1:1 mapping, same request/response pattern |
| **PTY management** | node-pty (657 LOC) | `portable-pty` or `pty-process` crate | Hardest piece—see detailed analysis below |
| **Database** | better-sqlite3 + Drizzle ORM | `rusqlite` + `diesel` or `sea-orm` | SQLite stays, ORM changes. Schema is small (3 tables) |
| **Git operations** | `child_process.execFile('git', ...)` | `std::process::Command` | Trivial mapping |
| **GitHub/ADO CLI** | `execFile('gh', ...)` / fetch API | `Command` / `reqwest` | Trivial |
| **Hook server** | Node HTTP server on ephemeral port | `axum` or `warp` micro-server | Small (4 endpoints) |
| **Auto-update** | electron-updater | `tauri-plugin-updater` | Built-in, arguably better |
| **Secure storage** | `electron.safeStorage` | `tauri-plugin-keychain` or OS keyring crate | Platform keychain access |
| **File watching** | `fs.watch()` | `notify` crate | More reliable than Node's fs.watch |
| **Desktop notifications** | Electron `Notification` | `tauri-plugin-notification` | Built-in |
| **Dialogs** | `dialog.showOpenDialog()` | `tauri-plugin-dialog` | Built-in |
| **Shell open** | `shell.openExternal()` | `tauri-plugin-shell` | Built-in |
| **App lifecycle** | `app.on('ready'/'before-quit')` | `tauri::Builder` + `RunEvent` handlers | Same events, different API |
| **Single instance** | `app.requestSingleInstanceLock()` | `tauri-plugin-single-instance` | Built-in |
| **Window config** | `BrowserWindow` options | `tauri.conf.json` + window API | Declarative config |
| **PATH detection** | Shell spawn to read PATH | Same approach via `Command` | Identical logic |
| **Preload/context bridge** | `preload.ts` + `contextBridge` | Not needed—Tauri commands are the bridge | Elimination of a layer |

---

## Deep Dive: The Hard Parts

### 1. PTY Management (High Risk, High Reward)

**Why it's hard:** node-pty is a battle-tested C++ binding with years of platform-specific edge case handling. The Rust PTY ecosystem is younger.

**Best option:** [`portable-pty`](https://docs.rs/portable-pty) from the wezterm project—the same PTY layer powering the Wezterm terminal emulator. It handles:
- Unix PTY via `openpty`/`forkpty`
- Windows ConPTY
- Signal forwarding
- Resize (SIGWINCH)
- Non-blocking reads

**What Dash actually needs from PTY:**
- `spawn(shell, args, {cwd, env, cols, rows})` → portable-pty `CommandBuilder` + `native_pty_system().openpty()`
- `write(data)` → `writer.write_all()`
- `resize(cols, rows)` → `master.resize()`
- `kill()` → `child.kill()` or signal
- `onData` callback → async read loop on master fd, emit via Tauri event
- `onExit` callback → `child.wait()` in async task

**Risk mitigation:** Wezterm is a production terminal emulator used daily by thousands. The PTY layer is proven. The wrapping logic (env setup, Claude CLI detection, hook settings writing) is straightforward Rust.

**Reward:** Rust's ownership model eliminates the class of PTY lifecycle bugs where a PTY handle outlives its process or vice versa. The async read loop integrates naturally with Tokio.

### 2. Database Migration (Medium Effort)

**Current:** better-sqlite3 (synchronous, C++ bindings) + Drizzle ORM (TypeScript)

**Target:** `rusqlite` (synchronous, C bindings) or `sqlx` (async)

The schema is minimal—3 tables with simple CRUD. Drizzle's migration files are standard SQL and can be reused directly. The ORM layer is thin enough that raw rusqlite queries or a lightweight ORM like `diesel` or `sea-orm` would be fine.

`rusqlite` compiles SQLite from source (via `bundled` feature), eliminating the native rebuild step entirely.

### 3. Hook Server (Low Risk)

4 HTTP endpoints on localhost. A `warp` or `axum` server is ~50 lines of Rust. The hook system itself (writing `.claude/settings.local.json`) is file I/O—trivial in Rust.

### 4. Pixel Agents Watcher (Medium Risk)

`@syv-ai/pixel-agents-watcher` is a custom native Node module. This either needs:
- A Rust equivalent (if the source is available)
- Spawning it as a sidecar process (Tauri supports this natively via `tauri-plugin-shell`)

The sidecar approach is pragmatic and avoids rewriting proprietary logic.

---

## Architecture Advantages of Tauri

### 1. Security Model (Significant Upgrade)

Electron's model: renderer has no Node access (good), but the main process is a full Node.js runtime with unrestricted system access. Any IPC handler bug is a privilege escalation.

Tauri's model: explicit **capability-based permissions**. Each `#[tauri::command]` must be declared in a capability file. The frontend can only call commands that are explicitly allowed. This is defense-in-depth that Electron cannot match.

For Dash specifically, this means the renderer can be granted access to PTY operations, git operations, and DB queries—but cannot arbitrarily execute shell commands or read files outside the allowed scope.

### 2. Process Architecture (Structural Improvement)

Electron bundles Chromium (~120MB) and runs two full V8 isolates. Tauri uses the OS webview:
- **macOS:** WKWebView (always available, always up-to-date via OS updates)
- **Linux:** WebKitGTK (must be installed, but is on all major distros)

This means:
- **Binary size:** ~150MB → ~15MB (10x reduction)
- **RAM at idle:** ~300MB → ~80MB (Dash runs alongside Claude Code, which is itself memory-hungry—this matters)
- **Startup time:** Faster cold start (no Chromium initialization)

### 3. Native Module Elimination

The current build requires `electron-rebuild` to compile node-pty and better-sqlite3 against Electron's Node headers. This is a persistent source of:
- CI complexity
- Version pinning issues
- Platform-specific build failures
- ASAR unpacking hacks

In Tauri, Rust crates compile as part of the normal `cargo build`. No rebuild step, no ASAR unpacking, no native module gymnastics.

### 4. Update Mechanism

`tauri-plugin-updater` supports the same GitHub releases workflow but with differential updates (only changed binaries). Combined with smaller binaries, updates download and apply faster.

### 5. Rust Backend Quality

Dash's backend is fundamentally a **process manager** (PTY lifecycle, child processes, file watching, IPC routing). Rust excels at exactly this:
- Ownership prevents PTY handle leaks
- `tokio` for async process management
- `serde` for type-safe IPC serialization (no more manual `IpcResponse<T>` wrappers)
- Compile-time guarantees eliminate runtime type errors in the backend

---

## Architecture Risks and Mitigations

### 1. WebView Inconsistencies

**Risk:** WebKitGTK on Linux may render differently than WKWebView on macOS.

**Mitigation:** Dash's UI is Tailwind CSS with xterm.js. Both are well-tested across WebKit. The app doesn't use exotic CSS or browser-specific APIs. xterm.js explicitly supports WebKit.

**Assessment:** Low risk. The UI is simple enough that cross-engine differences won't surface.

### 2. Linux WebKitGTK Dependency

**Risk:** Users must have WebKitGTK installed. On some minimal Linux installs, it's not present.

**Mitigation:** AppImage can bundle WebKitGTK. Alternatively, document the dependency (Dash already requires git, Claude CLI, and Node.js—one more system dependency is acceptable for a developer tool).

**Assessment:** Low risk for the target audience (developers with full desktop environments).

### 3. xterm.js Compatibility

**Risk:** xterm.js uses canvas/webgl rendering. Need to verify WebView canvas performance.

**Mitigation:** xterm.js works in WebKit browsers (Safari). WKWebView and WebKitGTK both support canvas and WebGL. Warp terminal (also WebView-based) proves this works at scale.

**Assessment:** Low risk.

### 4. Development Velocity

**Risk:** Rust has a steeper learning curve and slower iteration than TypeScript for the backend.

**Mitigation:** The team is comfortable with Rust (per problem statement). The backend is ~11.5K LOC of mostly straightforward I/O and process management—not algorithmic complexity. Rust's compiler catches bugs at compile time that would be runtime errors in TypeScript, so the net development velocity may be similar.

**Assessment:** Moderate short-term cost, long-term neutral or positive.

### 5. Ecosystem Maturity

**Risk:** Tauri's plugin ecosystem is younger than Electron's.

**Mitigation:** Dash uses very few Electron-specific libraries beyond the core APIs. The needed Tauri plugins (dialog, notification, shell, updater, single-instance) are all official and stable in Tauri 2.

**Assessment:** Low risk.

---

## Migration Strategy

### Phase 1: Parallel Backend (2 weeks)
1. `cargo init src-tauri` alongside existing Electron main process
2. Port database layer (rusqlite + migrations)
3. Port git/github/ado services (Command wrappers)
4. Port hook server (axum)
5. Verify with unit tests

### Phase 2: PTY Layer (1-2 weeks)
1. Implement PTY manager with portable-pty
2. Wire up Tauri event emitters for PTY data/exit
3. Port activity monitor
4. Port remote control service
5. Test Claude CLI spawning end-to-end

### Phase 3: Frontend Cutover (1 week)
1. Replace `window.electronAPI.*` with `@tauri-apps/api` calls
2. Update event listeners
3. Verify xterm.js in WebView
4. Port terminal snapshot save/restore

### Phase 4: Polish & Ship (1 week)
1. Auto-update configuration
2. macOS entitlements and code signing
3. Linux AppImage packaging
4. Pixel agents sidecar setup
5. Telemetry migration
6. E2E testing on both platforms

---

## What You Lose

1. **Guaranteed cross-platform rendering consistency** — Electron's bundled Chromium means pixel-perfect identical rendering on all platforms. With Tauri, macOS (WKWebView) and Linux (WebKitGTK) may have minor differences. For a developer tool with Tailwind CSS, this is negligible.

2. **Node.js ecosystem in the backend** — Any npm package is available in Electron's main process. In Tauri, you use Rust crates. The Rust ecosystem covers everything Dash needs, but if you later need a Node-only library, you'd run it as a sidecar.

3. **Hot reload for backend** — Electron's main process can be restarted quickly. Rust compilation is slower (though incremental builds are fast). `cargo watch` helps.

4. **electron-updater's maturity** — It handles edge cases (code signing validation, staged rollouts) that tauri-plugin-updater may not yet cover.

## What You Gain

1. **10x smaller binary** (~15MB vs ~150MB)
2. **3-4x lower memory usage** at idle
3. **Faster startup** (no Chromium boot)
4. **No native module rebuilds** (node-pty, better-sqlite3 pain eliminated)
5. **Capability-based security** (IPC permissions are explicit)
6. **Rust backend** perfectly suited for process/PTY management
7. **Compile-time safety** for the entire backend
8. **Simpler build pipeline** (cargo build vs electron-rebuild + ASAR unpacking)
9. **Differential updates** (smaller, faster updates)
10. **OS-native webview** stays current via OS updates (no Chromium CVE exposure)

---

## Conclusion

The migration is worth doing. Dash is a process manager at heart—spawning PTYs, managing child processes, routing IPC, watching files. Rust is the ideal language for this workload. The renderer stays untouched (React + xterm.js + Tailwind), and the IPC surface maps 1:1.

The only genuinely hard part is the PTY layer, and `portable-pty` (from wezterm) is a production-proven solution. Everything else—database, git operations, hook server, auto-update, notifications—has direct Tauri equivalents that are equal or better than the Electron versions.

The product benefits (smaller, faster, more secure, lower memory alongside Claude Code) directly serve users. The architecture benefits (no native module rebuilds, capability-based security, compile-time safety) directly serve the development team.
