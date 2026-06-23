import { z } from 'zod';

/**
 * Reusable zod schemas for domain objects crossing the IPC boundary.
 *
 * Entity inputs that flow into the database use `z.looseObject` (passthrough):
 * required fields are enforced and known fields are type-checked, but unknown
 * keys pass through untouched so we never silently drop a field the persistence
 * layer expects. File-specific argument shapes are defined inline in each
 * handler module; this file holds only the heavily-reused domain types.
 */

export const permissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions']);

/** A single linked issue / work item. Kept permissive (passthrough) — the
 *  provider-specific fields are renderer-built and reflected back as-is. */
const linkedItemSchema = z.looseObject({
  provider: z.enum(['github', 'ado']),
  id: z.number(),
  title: z.string(),
  url: z.string(),
});

/** `db:saveProject` — `Partial<Project> & { name: string; path: string }`. */
export const projectInputSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string(),
  path: z.string(),
  isGitRepo: z.boolean().optional(),
  gitRemote: z.string().nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  baseRef: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/** `db:saveTask` —
 *  `Partial<Task> & { projectId: string; name: string; branch: string; path: string }`. */
export const taskInputSchema = z.looseObject({
  id: z.string().optional(),
  projectId: z.string(),
  name: z.string(),
  branch: z.string(),
  path: z.string(),
  status: z.enum(['idle', 'active']).optional(),
  useWorktree: z.boolean().optional(),
  permissionMode: permissionModeSchema.optional(),
  branchCreatedByDash: z.boolean().optional(),
  linkedItems: z.array(linkedItemSchema).nullable().optional(),
  contextPrompt: z.string().nullable().optional(),
  setupScript: z.string().nullable().optional(),
  teardownScript: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  totalTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  tokensBackfilledAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/** A repo-relative path stored at a write boundary. Unlike the editor's file
 *  paths it is never opened (no `cwd` to resolve against — it's matched against
 *  diff entries and pruned), so `resolveInsideCwd` doesn't apply; the analog
 *  hardening is to reject the path shapes that have no legitimate meaning here:
 *  empty and null-byte-bearing. */
const storedRelPathSchema = z
  .string()
  .min(1, 'must not be empty')
  .refine((p) => !p.includes('\0'), 'must not contain a null byte');

/** `diffComments:upsert` — `DiffCommentInput`. */
export const diffCommentInputSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  filePath: storedRelPathSchema,
  startLine: z.number(),
  endLine: z.number(),
  text: z.string(),
  sent: z.boolean(),
  viewScope: z.string(),
});
