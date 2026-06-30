import { eq, desc, and, isNull, ne, asc, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { initDb, getDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { projects, tasks, conversations, taskPorts, featureDismissals } from '../db/schema';
import type {
  Project,
  Task,
  Conversation,
  LinkedItem,
  LoopConfig,
  TokenStatsRollup,
  PermissionMode,
  TaskStatus,
  TaskKind,
  TaskPort,
  PortSource,
} from '@shared/types';

function normalizePermissionMode(value: string | null | undefined): PermissionMode {
  return value === 'acceptEdits' || value === 'bypassPermissions' ? value : 'default';
}

function normalizeTaskStatus(value: string | null | undefined): TaskStatus {
  return value === 'active' ? 'active' : 'idle';
}

function normalizeTaskKind(value: string | null | undefined): TaskKind {
  return value === 'loop' ? 'loop' : 'standard';
}

function parseLoopConfig(value: string | null | undefined): LoopConfig | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as LoopConfig;
  } catch {
    return null; // Corrupted JSON — treat as a standard task at the data layer.
  }
}

export class DatabaseService {
  private static initialized = false;

  static initialize(): void {
    if (this.initialized) return;

    initDb();
    runMigrations();
    this.initialized = true;
  }

  // ── Projects ─────────────────────────────────────────────

  static getProjects(): Project[] {
    const db = getDb();
    const rows = db.select().from(projects).all();
    return rows.map(this.mapProject);
  }

  static saveProject(data: Partial<Project> & { name: string; path: string }): Project {
    const db = getDb();
    const id = data.id || randomUUID();
    const now = new Date().toISOString();

    db.insert(projects)
      .values({
        id,
        name: data.name,
        path: data.path,
        isGitRepo: data.isGitRepo ?? true,
        gitRemote: data.gitRemote ?? null,
        gitBranch: data.gitBranch ?? null,
        baseRef: data.baseRef ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: data.name,
          path: data.path,
          isGitRepo: data.isGitRepo ?? true,
          gitRemote: data.gitRemote ?? null,
          gitBranch: data.gitBranch ?? null,
          baseRef: data.baseRef ?? null,
          updatedAt: now,
        },
      })
      .run();

    const rows = db.select().from(projects).where(eq(projects.id, id)).all();
    return this.mapProject(rows[0]!);
  }

  static deleteProject(id: string): void {
    const db = getDb();
    db.delete(projects).where(eq(projects.id, id)).run();
  }

  /**
   * True when the user dismissed the given TUI feature for this project
   * ("Never for this project"). The wizard:requestStart IPC short-circuits on it.
   */
  static isFeatureDismissed(projectId: string, featureId: string): boolean {
    const db = getDb();
    const row = db
      .select({ at: featureDismissals.dismissedAt })
      .from(featureDismissals)
      .where(
        and(eq(featureDismissals.projectId, projectId), eq(featureDismissals.featureId, featureId)),
      )
      .get();
    return Boolean(row);
  }

  static markFeatureDismissed(projectId: string, featureId: string): void {
    const db = getDb();
    db.insert(featureDismissals)
      .values({ projectId, featureId, dismissedAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();
  }

  // ── Tasks ────────────────────────────────────────────────

  static getTasks(projectId: string): Task[] {
    const db = getDb();
    const rows = db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.sortOrder), desc(tasks.createdAt))
      .all();
    return rows.map(this.mapTask);
  }

  /**
   * Resume strategy in ptyManager (`claude --continue`) is correct only because
   * each task has a unique cwd: worktree tasks get their own dir by construction,
   * and non-worktree tasks must be unique per project path. UI gating in TaskModal
   * is best-effort; this is the load-bearing check.
   */
  private static findActiveNonWorktreeTaskAt(
    projectId: string,
    path: string,
    excludeId?: string,
  ): { id: string; name: string } | null {
    const db = getDb();
    const conditions = [
      eq(tasks.projectId, projectId),
      eq(tasks.path, path),
      eq(tasks.useWorktree, false),
      isNull(tasks.archivedAt),
    ];
    if (excludeId) conditions.push(ne(tasks.id, excludeId));
    const row = db
      .select({ id: tasks.id, name: tasks.name })
      .from(tasks)
      .where(and(...conditions))
      .get();
    return row ?? null;
  }

  static saveTask(
    data: Partial<Task> & { projectId: string; name: string; branch: string; path: string },
  ): Task {
    const db = getDb();
    const id = data.id || randomUUID();
    const now = new Date().toISOString();

    if (data.useWorktree === false) {
      const conflict = this.findActiveNonWorktreeTaskAt(data.projectId, data.path, id);
      if (conflict) {
        throw new Error(
          `Cannot save non-worktree task at "${data.path}": active task "${conflict.name}" already occupies this directory. Archive it first.`,
        );
      }
    }

    const linkedItemsJson = data.linkedItems ? JSON.stringify(data.linkedItems) : null;
    const loopConfigJson = data.loopConfig ? JSON.stringify(data.loopConfig) : null;

    // Wrap read-min + insert in a transaction so concurrent creates don't race on sortOrder
    db.transaction((tx) => {
      let sortOrder = data.sortOrder;
      if (sortOrder === undefined && !data.id) {
        const minRow = tx
          .select({ min: sql<number | null>`MIN(${tasks.sortOrder})` })
          .from(tasks)
          .where(eq(tasks.projectId, data.projectId))
          .all();
        const currentMin = minRow[0]?.min ?? 0;
        sortOrder = (currentMin ?? 0) - 1;
      }

      tx.insert(tasks)
        .values({
          id,
          projectId: data.projectId,
          name: data.name,
          branch: data.branch,
          path: data.path,
          status: data.status ?? 'idle',
          taskKind: data.taskKind ?? 'standard',
          loopConfig: loopConfigJson,
          useWorktree: data.useWorktree ?? true,
          permissionMode: data.permissionMode ?? 'default',
          branchCreatedByDash: data.branchCreatedByDash ?? false,
          linkedItems: linkedItemsJson,
          contextPrompt: data.contextPrompt ?? null,
          setupScript: data.setupScript ?? null,
          teardownScript: data.teardownScript ?? null,
          sortOrder: sortOrder ?? 0,
          createdAt: now,
          updatedAt: now,
        })
        // The update set is INSERT-only for the deep config fields on purpose.
        // `useWorktree` is immutable after creation (no setter; updateTask
        // passes the existing value), and `contextPrompt`/`setupScript`/
        // `teardownScript` have dedicated setters (setTaskContextPrompt,
        // setTaskScripts) precisely so a partial save like a rename can't
        // clobber them. Adding them here would null them out on every update
        // call that doesn't resend them (e.g. updateTask → rename wipes the
        // context prompt). Leave them out.
        .onConflictDoUpdate({
          target: tasks.id,
          set: {
            name: data.name,
            branch: data.branch,
            path: data.path,
            status: data.status ?? 'idle',
            permissionMode: data.permissionMode ?? 'default',
            linkedItems: linkedItemsJson,
            updatedAt: now,
          },
        })
        .run();
    });

    const rows = db.select().from(tasks).where(eq(tasks.id, id)).all();
    return this.mapTask(rows[0]!);
  }

  static getTask(id: string): Task | undefined {
    const db = getDb();
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
    return row ? this.mapTask(row) : undefined;
  }

  /**
   * Clone an existing task's config into a NEW row. The caller supplies the
   * already-provisioned identity (fresh worktree path + branch) and may override
   * the kind/config — e.g. "duplicate as loop" passes taskKind:'loop' + loopConfig.
   * Deep-config fields (contextPrompt, scripts) are carried over; runtime fields
   * (tokens, archivedAt, sortOrder) reset to defaults via saveTask.
   */
  static duplicateTask(
    sourceId: string,
    identity: { name: string; branch: string; path: string },
    overrides?: Partial<Task>,
  ): Task {
    const source = this.getTask(sourceId);
    if (!source) throw new Error(`Cannot duplicate: task "${sourceId}" not found`);

    return this.saveTask({
      projectId: source.projectId,
      name: identity.name,
      branch: identity.branch,
      path: identity.path,
      useWorktree: source.useWorktree,
      permissionMode: source.permissionMode,
      linkedItems: source.linkedItems,
      contextPrompt: source.contextPrompt,
      setupScript: source.setupScript,
      teardownScript: source.teardownScript,
      taskKind: source.taskKind,
      loopConfig: source.loopConfig,
      ...overrides,
    });
  }

  static setTaskContextPrompt(id: string, prompt: string): void {
    const db = getDb();
    db.update(tasks)
      .set({ contextPrompt: prompt, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();
  }

  /** Update a task's per-task worktree scripts (Task Settings edit). Null clears
   *  the override. Kept separate from saveTask so partial saves (rename, etc.)
   *  can't clobber these. */
  static setTaskScripts(
    id: string,
    setupScript: string | null,
    teardownScript: string | null,
  ): Task {
    const db = getDb();
    db.update(tasks)
      .set({ setupScript, teardownScript, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
    return this.mapTask(row!);
  }

  static updateTaskTokenStats(
    id: string,
    stats: { totalTokens: number; totalCostUsd: number },
  ): void {
    const db = getDb();
    db.update(tasks)
      .set({
        totalTokens: stats.totalTokens,
        totalCostUsd: stats.totalCostUsd,
        tokensBackfilledAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, id))
      .run();
  }

  static getProjectTokenStats(projectId: string): TokenStatsRollup {
    const db = getDb();
    const row = db
      .select({
        totalTokens: sql<number>`COALESCE(SUM(${tasks.totalTokens}), 0)`,
        totalCostUsd: sql<number>`COALESCE(SUM(${tasks.totalCostUsd}), 0)`,
        taskCount: sql<number>`COUNT(*)`,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .get();
    return {
      totalTokens: row?.totalTokens ?? 0,
      totalCostUsd: row?.totalCostUsd ?? 0,
      taskCount: row?.taskCount ?? 0,
    };
  }

  static getGlobalTokenStats(): TokenStatsRollup {
    const db = getDb();
    const row = db
      .select({
        totalTokens: sql<number>`COALESCE(SUM(${tasks.totalTokens}), 0)`,
        totalCostUsd: sql<number>`COALESCE(SUM(${tasks.totalCostUsd}), 0)`,
        taskCount: sql<number>`COUNT(*)`,
      })
      .from(tasks)
      .get();
    return {
      totalTokens: row?.totalTokens ?? 0,
      totalCostUsd: row?.totalCostUsd ?? 0,
      taskCount: row?.taskCount ?? 0,
    };
  }

  static listTasksNeedingBackfill(): Array<{ id: string; path: string }> {
    const db = getDb();
    return db
      .select({ id: tasks.id, path: tasks.path })
      .from(tasks)
      .where(isNull(tasks.tokensBackfilledAt))
      .all();
  }

  static deleteTask(id: string): void {
    const db = getDb();
    db.delete(tasks).where(eq(tasks.id, id)).run();
  }

  static archiveTask(id: string): void {
    const db = getDb();
    db.update(tasks)
      .set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();
  }

  static reorderTasks(projectId: string, orderedTaskIds: string[]): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.transaction((tx) => {
      orderedTaskIds.forEach((taskId, index) => {
        tx.update(tasks)
          .set({ sortOrder: index, updatedAt: now })
          .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
          .run();
      });
    });
  }

  static restoreTask(id: string): void {
    const db = getDb();
    const target = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!target) return;
    if (!target.useWorktree) {
      const conflict = this.findActiveNonWorktreeTaskAt(target.projectId, target.path, id);
      if (conflict) {
        throw new Error(
          `Cannot restore "${target.name}": active task "${conflict.name}" already occupies "${target.path}". Archive it first.`,
        );
      }
    }
    db.update(tasks)
      .set({ archivedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .run();
  }

  // ── Conversations ────────────────────────────────────────

  static getConversations(taskId: string): Conversation[] {
    const db = getDb();
    const rows = db.select().from(conversations).where(eq(conversations.taskId, taskId)).all();
    return rows.map(this.mapConversation);
  }

  static getOrCreateDefaultConversation(taskId: string): Conversation {
    const db = getDb();

    // Check if main conversation exists
    const existing = db.select().from(conversations).where(eq(conversations.taskId, taskId)).all();

    const main = existing.find((c) => c.isMain);
    if (main) return this.mapConversation(main);

    // Create default conversation
    const id = randomUUID();
    const now = new Date().toISOString();
    db.insert(conversations)
      .values({
        id,
        taskId,
        title: 'Main',
        isActive: true,
        isMain: true,
        displayOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const rows = db.select().from(conversations).where(eq(conversations.id, id)).all();
    return this.mapConversation(rows[0]!);
  }

  // ── Task ports ───────────────────────────────────────────

  static getTaskPorts(taskId: string): TaskPort[] {
    const db = getDb();
    const rows = db
      .select()
      .from(taskPorts)
      .where(eq(taskPorts.taskId, taskId))
      .orderBy(asc(taskPorts.label))
      .all();
    return rows.map(DatabaseService.mapTaskPort);
  }

  /**
   * Replace the full set of ports for a task in one transaction. We always
   * write the whole snapshot rather than diff-patching: the allocator's output
   * is the single source of truth, and a stale row left over from a previous
   * .dash/ports.json would break the env-var contract.
   */
  static setTaskPorts(
    taskId: string,
    assignments: Array<{
      label: string;
      envVar: string | null;
      defaultPort: number | null;
      hostPort: number;
      source: PortSource;
      runCommand: string | null;
      stopCommand: string | null;
      logsCommand: string | null;
      cwd: string | null;
    }>,
  ): TaskPort[] {
    const db = getDb();
    const now = new Date().toISOString();
    db.transaction((tx) => {
      tx.delete(taskPorts).where(eq(taskPorts.taskId, taskId)).run();
      if (assignments.length === 0) return;
      tx.insert(taskPorts)
        .values(
          assignments.map((a) => ({
            id: randomUUID(),
            taskId,
            label: a.label,
            envVar: a.envVar,
            defaultPort: a.defaultPort,
            hostPort: a.hostPort,
            source: a.source,
            runCommand: a.runCommand,
            stopCommand: a.stopCommand,
            logsCommand: a.logsCommand,
            cwd: a.cwd,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .run();
    });
    return DatabaseService.getTaskPorts(taskId);
  }

  static deleteTaskPorts(taskId: string): void {
    const db = getDb();
    db.delete(taskPorts).where(eq(taskPorts.taskId, taskId)).run();
  }

  /**
   * Host ports already claimed by other tasks. Used by the allocator's
   * collision-probe step so two worktrees never get the same host port.
   * Excludes archived tasks — once a task is archived, its port assignments
   * are no longer in service and should be freely re-issuable to others.
   */
  static getTakenHostPorts(excludeTaskId?: string): Set<number> {
    const db = getDb();
    const conditions = [isNull(tasks.archivedAt)];
    if (excludeTaskId) conditions.push(ne(tasks.id, excludeTaskId));
    const rows = db
      .select({ hostPort: taskPorts.hostPort })
      .from(taskPorts)
      .innerJoin(tasks, eq(taskPorts.taskId, tasks.id))
      .where(and(...conditions))
      .all();
    return new Set(rows.map((r) => r.hostPort));
  }

  /** Lookup the task by its worktree path. Used by ptyManager to merge port
   *  env vars into spawned PTYs without forcing the renderer to pass taskId. */
  static getTaskByPath(path: string): Task | undefined {
    const db = getDb();
    const row = db.select().from(tasks).where(eq(tasks.path, path)).get();
    return row ? DatabaseService.mapTask(row) : undefined;
  }

  // ── Mappers ──────────────────────────────────────────────

  private static mapProject(row: typeof projects.$inferSelect): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      isGitRepo: row.isGitRepo ?? true,
      gitRemote: row.gitRemote,
      gitBranch: row.gitBranch,
      baseRef: row.baseRef,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }

  private static mapTask(row: typeof tasks.$inferSelect): Task {
    let linkedItems: LinkedItem[] | null = null;
    if (row.linkedItems) {
      try {
        linkedItems = JSON.parse(row.linkedItems);
      } catch {
        // Corrupted JSON — ignore
      }
    }

    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      branch: row.branch,
      path: row.path,
      status: normalizeTaskStatus(row.status),
      taskKind: normalizeTaskKind(row.taskKind),
      loopConfig: parseLoopConfig(row.loopConfig),
      useWorktree: row.useWorktree ?? true,
      permissionMode: normalizePermissionMode(row.permissionMode),
      branchCreatedByDash: row.branchCreatedByDash ?? false,
      linkedItems,
      contextPrompt: row.contextPrompt ?? null,
      setupScript: row.setupScript ?? null,
      teardownScript: row.teardownScript ?? null,
      archivedAt: row.archivedAt,
      sortOrder: row.sortOrder,
      totalTokens: row.totalTokens ?? 0,
      totalCostUsd: row.totalCostUsd ?? 0,
      tokensBackfilledAt: row.tokensBackfilledAt ?? null,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }

  private static mapTaskPort(row: typeof taskPorts.$inferSelect): TaskPort {
    return {
      id: row.id,
      taskId: row.taskId,
      label: row.label,
      envVar: row.envVar,
      defaultPort: row.defaultPort,
      hostPort: row.hostPort,
      source: row.source as PortSource,
      runCommand: row.runCommand,
      stopCommand: row.stopCommand,
      logsCommand: row.logsCommand,
      cwd: row.cwd,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }

  private static mapConversation(row: typeof conversations.$inferSelect): Conversation {
    return {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      isActive: row.isActive ?? false,
      isMain: row.isMain ?? false,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt ?? '',
      updatedAt: row.updatedAt ?? '',
    };
  }
}
