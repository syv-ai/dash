# Electron → Tauri 2 Migration

## Summary

Migrate Dash from Electron to Tauri 2. Dash is fundamentally a process manager — spawning PTYs, managing child processes, routing IPC, watching files. Rust is the ideal backend for this workload, and Tauri's architecture maps cleanly onto our current design.

The main process (~11.5K LOC TypeScript) rewrites in Rust. The renderer (~7.5K LOC React/xterm.js/Tailwind) stays as-is. Estimated effort: ~4-6 developer-weeks.

## Why

| Metric | Electron (current) | Tauri (target) |
|--------|-------------------|----------------|
| Binary size | ~150 MB | ~15 MB |
| RAM at idle | ~300 MB | ~80 MB |
| Startup | Chromium boot overhead | Native webview, near-instant |
| Native module rebuilds | Required (node-pty, better-sqlite3) | None — `cargo build` handles everything |
| Security | Full Node.js runtime in main process | Capability-based IPC permissions |
| Backend safety | Runtime type errors possible | Compile-time guarantees |

Dash runs alongside Claude Code, which is itself memory-hungry. 3-4x lower memory matters.

### Why now

- The IPC surface (58 methods across 11 modules) is well-defined and stable — migration won't hit a moving target
- Three native modules (node-pty, better-sqlite3, pixel-agents-watcher) require `electron-rebuild` and ASAR unpacking — a persistent source of CI pain and platform-specific build failures
- Tauri 2 is stable with official plugins covering every Electron API we use

## Architecture Overview

### What stays the same

The entire React/xterm.js frontend is preserved. Tauri serves the same Vite-built SPA. The only renderer change is swapping `window.electronAPI.method()` calls to `@tauri-apps/api` invoke/event calls — a mechanical replacement against the 58-method `ElectronAPI` interface.

### What rewrites in Rust

| Component | Electron → Tauri | Difficulty |
|-----------|-----------------|------------|
| **IPC handlers** (11 modules, 58 methods) | `ipcMain.handle()` → `#[tauri::command]` | Easy — 1:1 mapping |
| **PTY management** (657 LOC) | node-pty → `portable-pty` crate (wezterm) | **Hard** — main risk area |
| **Database** (3 tables, simple CRUD) | better-sqlite3 + Drizzle → `rusqlite` | Medium |
| **Git/GitHub/ADO operations** | `child_process.execFile` → `std::process::Command` | Easy |
| **Hook server** (4 endpoints) | Node HTTP → `axum` micro-server | Easy |
| **Auto-update** | electron-updater → `tauri-plugin-updater` | Medium |
| **Secure storage** | `electron.safeStorage` → OS keyring / `tauri-plugin-keychain` | Medium |
| **File watching** | `fs.watch()` → `notify` crate | Easy (more reliable) |
| **Notifications, dialogs, shell open** | Electron APIs → Tauri plugins (built-in) | Easy |
| **Single instance** | `requestSingleInstanceLock` → `tauri-plugin-single-instance` | Easy |
| **Preload / context bridge** | `preload.ts` + `contextBridge` → eliminated entirely | N/A |

### What gets eliminated

- `preload.ts` and the context bridge layer — Tauri commands *are* the bridge
- `electron-rebuild` step and ASAR unpacking configuration
- `entry.ts` runtime path alias rewriting
- Bundled Chromium (~120 MB)

## The Hard Part: PTY Layer

The only genuinely difficult piece. Our PTY manager (657 LOC) handles spawning Claude CLI, shell PTYs, stdin/stdout streaming, resize, kill, environment setup, and hook settings injection.

**Best option:** [`portable-pty`](https://docs.rs/portable-pty) from the wezterm project — the same PTY layer powering a production terminal emulator used daily by thousands.

**API mapping:**
| Dash needs | portable-pty equivalent |
|-----------|------------------------|
| `spawn(shell, args, {cwd, env, cols, rows})` | `CommandBuilder` + `native_pty_system().openpty()` |
| `write(data)` | `writer.write_all()` |
| `resize(cols, rows)` | `master.resize()` |
| `kill()` | `child.kill()` or signal |
| `onData` callback | Async read loop on master fd, emit via Tauri event |
| `onExit` callback | `child.wait()` in async task |

**Why Rust is actually better here:** Ownership model eliminates the class of PTY lifecycle bugs where a handle outlives its process or vice versa. The async read loop integrates naturally with Tokio.

## Architecture Advantages

### Security model (significant upgrade)

Electron: the main process is a full Node.js runtime with unrestricted system access. Any IPC handler bug is a privilege escalation.

Tauri: explicit capability-based permissions. Each `#[tauri::command]` must be declared in a capability file. The renderer can be granted access to PTY operations, git operations, and DB queries — but cannot arbitrarily execute shell commands or read files outside the allowed scope.

### Native module elimination

Current build requires `electron-rebuild` to compile node-pty and better-sqlite3 against Electron's Node headers. This causes CI complexity, version pinning issues, platform-specific build failures, and ASAR unpacking hacks. In Tauri, Rust crates compile as part of normal `cargo build`. `rusqlite` with the `bundled` feature compiles SQLite from source — no external dependency at all.

### Rust backend fit

- `tokio` for async process management
- `serde` for type-safe IPC serialization (eliminates manual `IpcResponse<T>` wrappers)
- `notify` crate is more reliable than Node's `fs.watch()`
- Compile-time guarantees eliminate entire categories of runtime errors

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| WebView rendering differences (macOS WKWebView vs Linux WebKitGTK) | Low | UI is Tailwind + xterm.js, both well-tested across WebKit engines |
| Linux WebKitGTK dependency | Low | Target audience (developers) has full desktop environments; can bundle in AppImage |
| xterm.js canvas/WebGL perf in WebView | Low | Works in Safari/WebKit; Warp terminal (also WebView-based) proves this at scale |
| Slower backend iteration (Rust compile times) | Moderate | `cargo watch` + incremental builds; compile-time catches offset runtime debugging time |
| Pixel Agents watcher (custom native Node module) | Medium | Run as Tauri sidecar process — avoids rewrite entirely |

## What We Lose

- **Pixel-identical cross-platform rendering** — Electron's bundled Chromium guarantees identical rendering everywhere. With Tauri, macOS and Linux use different WebKit engines. For a developer tool styled with Tailwind CSS, this is negligible.
- **Node.js ecosystem in the backend** — Any npm package is available in Electron's main process. In Tauri, we use Rust crates. They cover everything Dash needs; sidecars are available for anything they don't.
- **Backend hot reload** — Electron's main process restarts quickly. Rust compilation is slower, though incremental builds and `cargo watch` help.
- **electron-updater's edge case handling** — Staged rollouts, code signing validation edge cases. `tauri-plugin-updater` covers our GitHub releases workflow but is younger.

## Migration Plan

### Phase 1: Parallel Backend (~2 weeks)
- [ ] `cargo init src-tauri` alongside existing Electron main process
- [ ] Port database layer (`rusqlite` + existing SQL migration files)
- [ ] Port git/github/ado services (`std::process::Command` wrappers)
- [ ] Port hook server (`axum`, 4 endpoints)
- [ ] Unit tests for all ported services

### Phase 2: PTY Layer (~1-2 weeks)
- [ ] Implement PTY manager with `portable-pty`
- [ ] Wire up Tauri event emitters for PTY data/exit streaming
- [ ] Port activity monitor (busy/idle/waiting state tracking)
- [ ] Port remote control service (URL detection in PTY output)
- [ ] End-to-end test: spawn Claude CLI, interact, resize, kill

### Phase 3: Frontend Cutover (~1 week)
- [ ] Replace all `window.electronAPI.*` calls with `@tauri-apps/api` invoke/events
- [ ] Update event listeners across 58 IPC methods
- [ ] Verify xterm.js rendering and performance in WebView (macOS + Linux)
- [ ] Port terminal snapshot save/restore

### Phase 4: Polish & Ship (~1 week)
- [ ] Auto-update configuration via GitHub releases
- [ ] macOS code signing and entitlements
- [ ] Linux AppImage packaging
- [ ] Pixel agents sidecar setup
- [ ] Telemetry migration (PostHog)
- [ ] E2E testing on both platforms
- [ ] Remove all Electron dependencies from package.json
