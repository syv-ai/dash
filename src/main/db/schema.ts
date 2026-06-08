import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
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
    linkedItems: text('linked_items'),
    contextPrompt: text('context_prompt'),
    branchCreatedByDash: integer('branch_created_by_dash', { mode: 'boolean' }).default(false),
    // Deprecated since 0.9.9: was used to pin Claude session_id captured by a
    // SessionStart hook before we switched to `claude --continue`. Column kept
    // to avoid a destructive migration. Do not read or write.
    lastSessionId: text('last_session_id'),
    archivedAt: text('archived_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    totalCostUsd: real('total_cost_usd').notNull().default(0),
    tokensBackfilledAt: text('tokens_backfilled_at'),
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
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskFileIdx: index('idx_diff_editor_comments_task_file').on(table.taskId, table.filePath),
  }),
);
