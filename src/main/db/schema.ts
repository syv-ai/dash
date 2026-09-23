import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    isGitRepo: integer('is_git_repo', { mode: 'boolean' }).default(true),
    gitRemote: text('git_remote'),
    gitBranch: text('git_branch'),
    baseRef: text('base_ref'),
    // Deprecated since 0.13: replaced by .dash/config.json setup commands.
    // Column kept so existing DBs don't break; do not read or write.
    worktreeSetupScript: text('worktree_setup_script'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pathIdx: uniqueIndex('idx_projects_path').on(table.path),
  }),
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    branch: text('branch').notNull(),
    path: text('path').notNull(),
    status: text('status').notNull().default('idle'),
    useWorktree: integer('use_worktree', { mode: 'boolean' }).default(true),
    // Deprecated since 0.10: replaced by permission_mode. Kept so existing DBs
    // don't break; do not read or write. New rows leave this at default (false).
    autoApprove: integer('auto_approve', { mode: 'boolean' }).default(false),
    // 'default' | 'acceptEdits' | 'bypassPermissions' — see PermissionMode in shared/types
    permissionMode: text('permission_mode').notNull().default('default'),
    // 'default' | 'opus' | 'sonnet' | 'haiku' | 'fable' — see TaskModel in shared/types.
    // 'default' → no `--model` flag (respect the user's Claude Code config).
    model: text('model').notNull().default('default'),
    linkedItems: text('linked_items'),
    contextPrompt: text('context_prompt'),
    // Per-task overrides of the project's default worktree scripts (newline-
    // separated commands). Null = no per-task scripts. Snapshotted from
    // .dash/config.json at creation; editable per task.
    setupScript: text('setup_script'),
    teardownScript: text('teardown_script'),
    branchCreatedByDash: integer('branch_created_by_dash', { mode: 'boolean' }).default(false),
    // Deprecated since 0.9.9: was used to pin Claude session_id captured by a
    // SessionStart hook before we switched to `claude --continue`. Column kept
    // to avoid a destructive migration. Do not read or write.
    lastSessionId: text('last_session_id'),
    // Pre-migration worktree path (0.16 moved worktrees under `<repo>/.claude/`).
    // Null for tasks created at the current location or never moved. Read by
    // session resume + token aggregation, which look in both transcript dirs.
    previousPath: text('previous_path'),
    // Claude Code supervisor job for the task's session (0.16): the short job
    // id from `claude agents --json`, the session UUID for `--bg --resume`, and
    // when the session was last stopped (archive / idle stop). Null until the
    // task's first dispatch.
    jobId: text('job_id'),
    sessionId: text('session_id'),
    sessionStoppedAt: text('session_stopped_at'),
    archivedAt: text('archived_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    totalCostUsd: real('total_cost_usd').notNull().default(0),
    tokensBackfilledAt: text('tokens_backfilled_at'),
    // FK pointer to drawer_tabs.id. Nullable when a task has no tabs.
    activeDrawerTabId: text('active_drawer_tab_id'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
  }),
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    isMain: integer('is_main', { mode: 'boolean' }).notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdIdx: index('idx_conversations_task_id').on(table.taskId),
  }),
);

export const diffEditorComments = sqliteTable(
  'diff_editor_comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    text: text('text').notNull(),
    sent: integer('sent', { mode: 'boolean' }).notNull().default(false),
    /** Diff state the comment is anchored to: 'live' (working/branch views,
     *  which share the working file) or 'commit:<hash>' for a frozen commit. */
    viewScope: text('view_scope').notNull().default('live'),
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskFileIdx: index('idx_diff_editor_comments_task_file').on(table.taskId, table.filePath),
  }),
);

// Drawer tabs per task. Replaces the per-task `shellTabs:<taskId>` localStorage
// keys so main can mutate the tab list (e.g. add the ports TUI tab) without
// round-tripping through renderer state. `id` matches the PTY id when the tab
// owns one.
export const drawerTabs = sqliteTable(
  'drawer_tabs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'shell' | 'service'
    featureId: text('feature_id'),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    taskPosIdx: index('idx_drawer_tabs_task').on(table.taskId, table.position),
  }),
);
