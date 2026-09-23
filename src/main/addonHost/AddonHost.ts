import {
  BlocksSchema,
  DrawerSchema,
  type Addon,
  type AddonContext,
  type AddonSurfaces,
  type HookContribution,
  type SurfaceRef,
  type TaskInfo,
  type TerminalHandle,
  type TerminalRunOptions,
  type WorktreeRef,
} from '@shared/addon-api';
import type { AddonListItem, AddonSurfaceSet } from '@shared/addons';
import type { AddonStore } from './addonStore';

/** Everything the host needs from the rest of Dash. Faked in tests. */
export interface HostDeps {
  store: AddonStore;
  reservedEnvKeys: ReadonlySet<string>;
  dataDir(addonId: string): string;
  tasks: {
    get(taskId: string): TaskInfo | undefined;
    list(): TaskInfo[];
    create(opts: { projectId: string; name: string; initialPrompt?: string }): Promise<TaskInfo>;
    activate(taskId: string): void;
    restartSessions(taskId: string): void;
    refreshHooks(): Promise<void>;
  };
  terminals: {
    run(addonId: string, taskId: string, opts: TerminalRunOptions): Promise<TerminalHandle>;
    stop(addonId: string, taskId: string, key: string): void;
    isRunning(addonId: string, taskId: string, key: string): boolean;
    focus(addonId: string, taskId: string, key: string, opts?: { reset?: boolean }): void;
  };
  /** Watch a directory in a task's worktree; returns a disposer. */
  watchDir(taskId: string, relDir: string, fn: (changedFiles: string[]) => void): () => void;
  toast(t: { kind: 'info' | 'success' | 'warning' | 'error'; title: string; body?: string }): void;
  openUrl(url: string): void;
  copy(text: string): void;
  exec(command: string, cwd: string): Promise<{ code: number; stderrTail: string }>;
  emitChanged(addonId: string): void;
  notifyEnvChanged(addonId: string): void;
  log: Pick<Console, 'info' | 'warn' | 'error'>;
  activateTimeoutMs?: number;
  refreshDebounceMs?: number;
}

type TaskEvent = 'taskCreated' | 'taskDeleted';

interface Runtime {
  addon: Addon;
  status: 'activating' | 'active' | 'failed' | 'disabled';
  error?: string;
  surfaces?: AddonSurfaces;
  /** False once this activation is torn down; late registrations are ignored. */
  session: { live: boolean };
  disposers: Array<() => void>;
  env: Array<(wt: WorktreeRef) => Record<string, string>>;
  path: Array<() => string[]>;
  hooks: Array<() => HookContribution[]>;
  listeners: Map<TaskEvent, Array<(task: TaskInfo) => void>>;
  /** Terminals started by this activation, by tab id. */
  terminals: Map<string, { taskId: string; key: string; onClosed?: () => void }>;
  refreshTimer?: ReturnType<typeof setTimeout>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class AddonHost {
  private readonly runtimes = new Map<string, Runtime>();

  constructor(
    private readonly addons: readonly Addon[],
    private readonly deps: HostDeps,
  ) {
    for (const addon of addons) {
      this.runtimes.set(addon.id, this.blankRuntime(addon, 'disabled'));
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  isEnabled(addonId: string): boolean {
    const rt = this.runtimes.get(addonId);
    if (!rt) return false;
    return this.deps.store.getEnabled(addonId) ?? rt.addon.defaultEnabled;
  }

  /** Activate every enabled add-on; resolves once all have settled. */
  async start(): Promise<void> {
    await Promise.all(
      this.addons.filter((a) => this.isEnabled(a.id)).map((a) => this.activate(a.id)),
    );
  }

  /** Tear every add-on down (quit). Enable state is left as it is. */
  async stop(): Promise<void> {
    await Promise.all(this.addons.map((a) => this.teardown(a.id)));
  }

  async setEnabled(addonId: string, enabled: boolean): Promise<void> {
    const rt = this.runtimes.get(addonId);
    if (!rt) throw new Error(`Unknown add-on: ${addonId}`);
    this.deps.store.setEnabled(addonId, enabled);
    const hadSessionEnv = this.hasSessionEnv(rt);
    if (enabled) {
      if (rt.status === 'active' || rt.status === 'activating') return;
      await this.activate(addonId);
    } else {
      await this.teardown(addonId);
    }
    const current = this.runtimes.get(addonId)!;
    if (hadSessionEnv || this.hasSessionEnv(current)) this.deps.notifyEnvChanged(addonId);
    await this.refreshHooksQuietly();
    this.deps.emitChanged(addonId);
  }

  private async activate(addonId: string): Promise<void> {
    const prev = this.runtimes.get(addonId)!;
    const rt = this.blankRuntime(prev.addon, 'activating');
    this.runtimes.set(addonId, rt);

    const timeoutMs = this.deps.activateTimeoutMs ?? 10_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const activation = Promise.resolve().then(() => rt.addon.activate(this.createContext(rt)));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`activation timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    });

    try {
      const surfaces = await Promise.race([activation, timeout]);
      if (!rt.session.live) {
        // Disabled while activating: drop what it returned.
        void Promise.resolve(surfaces.dispose?.()).catch(() => {});
        return;
      }
      rt.surfaces = surfaces;
      rt.status = 'active';
    } catch (err) {
      this.deps.log.error(`[addon:${addonId}] activation failed:`, err);
      this.disposeRegistrations(rt);
      rt.status = 'failed';
      rt.error = message(err);
      // A late resolve after a timeout must not leave anything behind.
      activation.then((s) => s.dispose?.()).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  }

  private async teardown(addonId: string): Promise<void> {
    const rt = this.runtimes.get(addonId)!;
    const surfaces = rt.surfaces;
    this.disposeRegistrations(rt);
    this.runtimes.set(addonId, this.blankRuntime(rt.addon, 'disabled'));
    if (surfaces?.dispose) {
      try {
        await surfaces.dispose();
      } catch (err) {
        this.deps.log.error(`[addon:${addonId}] dispose failed:`, err);
      }
    }
  }

  private disposeRegistrations(rt: Runtime): void {
    rt.session.live = false;
    if (rt.refreshTimer) clearTimeout(rt.refreshTimer);
    for (const dispose of rt.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (err) {
        this.deps.log.error(`[addon:${rt.addon.id}] disposer failed:`, err);
      }
    }
    rt.env = [];
    rt.path = [];
    rt.hooks = [];
    rt.listeners.clear();
    rt.terminals.clear();
  }

  private blankRuntime(addon: Addon, status: Runtime['status']): Runtime {
    return {
      addon,
      status,
      session: { live: status !== 'disabled' },
      disposers: [],
      env: [],
      path: [],
      hooks: [],
      listeners: new Map(),
      terminals: new Map(),
    };
  }

  private hasSessionEnv(rt: Runtime): boolean {
    return rt.env.length > 0 || rt.path.length > 0;
  }

  private async refreshHooksQuietly(): Promise<void> {
    try {
      await this.deps.tasks.refreshHooks();
    } catch (err) {
      this.deps.log.warn('[addons] hook refresh failed:', err);
    }
  }

  // ── The context an add-on sees ─────────────────────────────────

  private createContext(rt: Runtime): AddonContext {
    const id = rt.addon.id;
    const deps = this.deps;
    const live = () => rt.session.live;
    const register = <T>(list: T[], item: T) => {
      if (live()) list.push(item);
    };
    let dataDir: string | undefined;

    return {
      session: {
        env: (fn) => register(rt.env, fn),
        path: (fn) => register(rt.path, fn),
        hooks: (fn) => register(rt.hooks, fn),
      },
      on: (event, fn) => {
        if (!live()) return;
        const list = rt.listeners.get(event) ?? [];
        list.push(fn);
        rt.listeners.set(event, list);
      },
      storage: {
        get: (scope, key) => deps.store.get(id, scope, key),
        set: (scope, key, value) => deps.store.set(id, scope, key, value),
        delete: (scope, key) => deps.store.delete(id, scope, key),
        list: (scopeKind, key) => deps.store.list(id, scopeKind, key),
      },
      tasks: {
        get: (taskId) => deps.tasks.get(taskId),
        list: () => deps.tasks.list(),
        create: (opts) => deps.tasks.create(opts),
        activate: (taskId) => deps.tasks.activate(taskId),
        restartSessions: (taskId) => deps.tasks.restartSessions(taskId),
        refreshHooks: () => deps.tasks.refreshHooks(),
      },
      terminals: {
        run: async (taskId, opts) => {
          if (!live()) throw new Error(`add-on ${id} is not active`);
          const handle = await deps.terminals.run(id, taskId, opts);
          if (!live()) {
            deps.terminals.stop(id, taskId, opts.key);
            throw new Error(`add-on ${id} is not active`);
          }
          const known = rt.terminals.has(handle.tabId);
          rt.terminals.set(handle.tabId, { taskId, key: opts.key, onClosed: opts.onClosed });
          if (!known) rt.disposers.push(() => deps.terminals.stop(id, taskId, opts.key));
          return handle;
        },
        stop: (taskId, key) => deps.terminals.stop(id, taskId, key),
        isRunning: (taskId, key) => deps.terminals.isRunning(id, taskId, key),
        focus: (taskId, key, opts) => deps.terminals.focus(id, taskId, key, opts),
      },
      files: {
        watch: (taskId, relDir, fn) => {
          if (!live()) return () => {};
          // Disposers must be idempotent: the add-on may stop a watch early and
          // the host disposes every registration again on disable.
          const dispose = deps.watchDir(taskId, relDir, fn);
          rt.disposers.push(dispose);
          return dispose;
        },
      },
      notify: { toast: (t) => deps.toast(t) },
      shell: {
        openUrl: (url) => deps.openUrl(url),
        copy: (text) => deps.copy(text),
        exec: (command, cwd) => deps.exec(command, cwd),
      },
      paths: {
        get data() {
          dataDir ??= deps.dataDir(id);
          return dataDir;
        },
      },
      setInterval: (fn, ms) => {
        if (!live()) return;
        const handle = setInterval(() => {
          try {
            fn();
          } catch (err) {
            deps.log.error(`[addon:${id}] interval failed:`, err);
          }
        }, ms);
        rt.disposers.push(() => clearInterval(handle));
      },
      log: {
        info: (...args: unknown[]) => deps.log.info(`[addon:${id}]`, ...args),
        warn: (...args: unknown[]) => deps.log.warn(`[addon:${id}]`, ...args),
        error: (...args: unknown[]) => deps.log.error(`[addon:${id}]`, ...args),
      },
      refresh: () => {
        if (!live()) return;
        if (rt.refreshTimer) clearTimeout(rt.refreshTimer);
        rt.refreshTimer = setTimeout(() => {
          rt.refreshTimer = undefined;
          if (live()) deps.emitChanged(id);
        }, deps.refreshDebounceMs ?? 50);
      },
    };
  }

  // ── What core asks for ─────────────────────────────────────────

  private active(): Runtime[] {
    return this.addons.map((a) => this.runtimes.get(a.id)!).filter((rt) => rt.status === 'active');
  }

  /** Env for a worktree's PTYs; later add-ons win; reserved keys dropped. */
  envFor(wt: WorktreeRef): Record<string, string> {
    const env: Record<string, string> = {};
    for (const rt of this.active()) {
      for (const fn of rt.env) {
        try {
          for (const [k, v] of Object.entries(fn(wt))) {
            if (!this.deps.reservedEnvKeys.has(k) && typeof v === 'string') env[k] = v;
          }
        } catch (err) {
          this.deps.log.error(`[addon:${rt.addon.id}] env contribution failed:`, err);
        }
      }
    }
    return env;
  }

  /** Directories to prepend to PATH, de-duplicated, in add-on order. */
  pathDirs(): string[] {
    const dirs: string[] = [];
    for (const rt of this.active()) {
      for (const fn of rt.path) {
        try {
          for (const d of fn()) if (d && !dirs.includes(d)) dirs.push(d);
        } catch (err) {
          this.deps.log.error(`[addon:${rt.addon.id}] path contribution failed:`, err);
        }
      }
    }
    return dirs;
  }

  hookEntries(): HookContribution[] {
    const entries: HookContribution[] = [];
    for (const rt of this.active()) {
      for (const fn of rt.hooks) {
        try {
          entries.push(...fn());
        } catch (err) {
          this.deps.log.error(`[addon:${rt.addon.id}] hook contribution failed:`, err);
        }
      }
    }
    return entries;
  }

  emit(event: TaskEvent, task: TaskInfo): void {
    for (const rt of this.active()) {
      for (const fn of rt.listeners.get(event) ?? []) {
        try {
          fn(task);
        } catch (err) {
          this.deps.log.error(`[addon:${rt.addon.id}] ${event} listener failed:`, err);
        }
      }
    }
  }

  /** The user closed an add-on-owned drawer tab. */
  terminalClosed(tabId: string): void {
    for (const rt of this.active()) {
      const entry = rt.terminals.get(tabId);
      if (!entry) continue;
      try {
        entry.onClosed?.();
      } catch (err) {
        this.deps.log.error(`[addon:${rt.addon.id}] onClosed failed:`, err);
      }
    }
  }

  // ── What the renderer asks for ─────────────────────────────────

  list(): AddonListItem[] {
    return this.addons.map((addon) => {
      const rt = this.runtimes.get(addon.id)!;
      const status = rt.status === 'activating' ? 'active' : rt.status;
      return {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        enabled: this.isEnabled(addon.id),
        status,
        ...(rt.error ? { error: rt.error } : {}),
        hasDrawer: rt.status === 'active' && typeof rt.surfaces?.drawer === 'function',
        drawerSide: addon.drawerSide ?? 'right',
      };
    });
  }

  surfacesFor(taskId: string | null): AddonSurfaceSet[] {
    const task = taskId ? (this.deps.tasks.get(taskId) ?? null) : null;
    const out: AddonSurfaceSet[] = [];
    for (const rt of this.active()) {
      const s = rt.surfaces;
      if (!s) continue;
      const set: AddonSurfaceSet = { addonId: rt.addon.id };
      if (s.settings) {
        try {
          set.settings = BlocksSchema.parse(s.settings());
        } catch (err) {
          set.settingsError = this.surfaceError(rt, 'settings', err);
        }
      }
      if (s.drawer) {
        try {
          const drawer = s.drawer(task);
          if (drawer !== null) set.drawer = DrawerSchema.parse(drawer);
        } catch (err) {
          set.drawerError = this.surfaceError(rt, 'drawer', err);
        }
      }
      out.push(set);
    }
    return out;
  }

  private surfaceError(rt: Runtime, surface: string, err: unknown): string {
    this.deps.log.error(`[addon:${rt.addon.id}] ${surface} surface failed:`, err);
    return `${rt.addon.name}: ${message(err)}`;
  }

  async action(addonId: string, ref: SurfaceRef, actionId: string): Promise<void> {
    const rt = this.runtimes.get(addonId);
    if (!rt || rt.status !== 'active' || !rt.surfaces?.onAction) return;
    try {
      await rt.surfaces.onAction(ref, actionId);
    } catch (err) {
      this.deps.log.error(`[addon:${addonId}] action ${actionId} failed:`, err);
      this.deps.toast({ kind: 'error', title: `${rt.addon.name}: ${message(err)}` });
    }
  }
}
