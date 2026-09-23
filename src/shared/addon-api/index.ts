// The add-on contract. Add-ons (src/main/addons/<id>/) may import only this
// module; the host (src/main/addonHost/) implements it. See
// docs/specs/2026-09-23-addons.md.

import type { Block, Drawer } from './blocks';

export * from './blocks';

export interface TaskInfo {
  id: string;
  projectId: string;
  name: string;
  path: string;
  /** False for tasks that run in the project directory itself. */
  useWorktree: boolean;
  archived: boolean;
}

export type StorageScope = 'global' | { project: string } | { task: string };

/** A Claude Code hook entry. Only the events an add-on needs so far. */
export interface HookContribution {
  event: 'PreToolUse';
  matcher: string;
  command: string;
}

export type SurfaceName = 'settings' | 'drawer';
export interface SurfaceRef {
  surface: SurfaceName;
  taskId?: string;
}

/**
 * What an add-on shows and handles. Every surface is optional: an add-on
 * without `drawer` has no drawer, and `drawer` returning null hides it for
 * that task. Surfaces are pure functions of add-on state; call ctx.refresh()
 * after changing that state.
 */
export interface AddonSurfaces {
  settings?(): Block[];
  drawer?(task: TaskInfo | null): Drawer | null;
  onAction?(ref: SurfaceRef, actionId: string): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface TerminalHandle {
  key: string;
  tabId: string;
}

export interface TerminalRunOptions {
  /** Stable per task; the drawer tab id derives from it. */
  key: string;
  label: string;
  command: string;
  /** Absolute, or relative to the task's worktree. Defaults to the worktree. */
  cwd?: string;
  env?: Record<string, string>;
  /** The process exited on its own (not via stop()). */
  onExit?: () => void;
  /** The user closed the drawer tab. */
  onClosed?: () => void;
}

export interface WorktreeRef {
  path: string;
  taskId: string | null;
}

export interface AddonContext {
  session: {
    /** Env for a worktree's Claude session and shell PTYs. Synchronous; reserved keys are ignored. */
    env(fn: (wt: WorktreeRef) => Record<string, string>): void;
    /** Directories prepended to PATH for the same PTYs. */
    path(fn: () => string[]): void;
    /** Claude Code hook entries merged into each worktree's settings.local.json. */
    hooks(fn: () => HookContribution[]): void;
  };
  on(event: 'taskCreated' | 'taskDeleted', fn: (task: TaskInfo) => void): void;
  storage: {
    get<T>(scope: StorageScope, key: string): T | undefined;
    set(scope: StorageScope, key: string, value: unknown): void;
    delete(scope: StorageScope, key: string): void;
    list<T>(scopeKind: 'project' | 'task', key: string): Array<{ scopeId: string; value: T }>;
  };
  tasks: {
    get(taskId: string): TaskInfo | undefined;
    list(): TaskInfo[];
    create(opts: { projectId: string; name: string; initialPrompt?: string }): Promise<TaskInfo>;
    activate(taskId: string): void;
    restartSessions(taskId: string): void;
    refreshHooks(): Promise<void>;
  };
  terminals: {
    run(taskId: string, opts: TerminalRunOptions): Promise<TerminalHandle>;
    stop(taskId: string, key: string): void;
    isRunning(taskId: string, key: string): boolean;
    focus(taskId: string, key: string, opts?: { reset?: boolean }): void;
  };
  files: {
    /** Watch a directory in the task's worktree, retrying until it exists. */
    watch(taskId: string, relDir: string, fn: (changedFiles: string[]) => void): () => void;
  };
  notify: {
    toast(t: {
      kind: 'info' | 'success' | 'warning' | 'error';
      title: string;
      body?: string;
    }): void;
  };
  shell: {
    openUrl(url: string): void;
    copy(text: string): void;
    /** Run a short-lived command in the user's login shell. Never rejects. */
    exec(command: string, cwd: string): Promise<{ code: number; stderrTail: string }>;
  };
  paths: {
    /** The add-on's own directory under userData, created on first access. */
    readonly data: string;
  };
  setInterval(fn: () => void, ms: number): void;
  log: Pick<Console, 'info' | 'warn' | 'error'>;
  /** Re-run this add-on's surfaces and push them to the renderer. */
  refresh(): void;
}

export interface Addon {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  /** Default sidebar for the drawer; the user can change it. */
  drawerSide?: 'left' | 'right';
  activate(ctx: AddonContext): AddonSurfaces | Promise<AddonSurfaces>;
}

export function defineAddon(addon: Addon): Addon {
  return addon;
}
