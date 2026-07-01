import * as fs from 'fs';
import * as path from 'path';
import { loadWorkspacePorts, loadPortOverrides } from './WorkspacePortsService';
import { allocatePorts } from './PortAllocator';
import { composeWorktreeEnv, formatEnvExport } from './derivedEnv';
import { DatabaseService } from './DatabaseService';
import type { TaskPort } from '@shared/types';

const GITIGNORE_FILE = '.gitignore';

// Header marker introduces the Dash-managed section; entries are kept in sync
// per-line (see ensureGitignoreEntries) so adding a new managed file ignores it
// even on worktrees onboarded before that file existed.
const GITIGNORE_HEADER = '# Dash — port management (generated per-worktree; do not commit)';

// Default path (relative to the worktree root) for the sourceable export file.
// Matches the conventional name a hand-rolled dev.sh writes, so existing
// `source .env.worktree` workflows keep working.
const DEFAULT_EXPORT_FILE = '.env.worktree';

export interface SetupTaskArgs {
  taskId: string;
  worktreePath: string;
  /**
   * Identifier hashed by the allocator to derive per-worktree offsets. Defaults
   * to the worktree directory basename so two developers cloning the same
   * branch get the same ports — matches the property the foundation hash was
   * designed for. Pass an explicit value when the basename isn't stable
   * (e.g. some non-worktree task layouts).
   */
  hashKey?: string;
}

/**
 * Orchestrates the per-task port lifecycle:
 *   load schema + overrides → query DB for taken host ports → allocate →
 *   persist to task_ports → write the sourceable export file.
 *
 * Two surfaces consume the result and must stay identical: the PTY env Dash
 * injects at spawn, and the on-disk export file that tools outside a Dash PTY
 * (pytest, alembic, docker compose, CI) source. Both are built from
 * `buildEnv`, so the same ports + derived vars land in each.
 */
export class WorkspacePortsRuntime {
  /**
   * Resolve and persist port assignments for a task. No-op (returns empty
   * array) when `.dash/ports.json` is missing or malformed — we keep going
   * with no ports rather than blocking worktree setup on a bad config.
   *
   * Pass `errors` to capture validation failures: after the call, a non-empty
   * array means the file existed but was invalid (vs. absent, which leaves it
   * empty). The watcher uses this to surface a recoverable error in the setup
   * wizard instead of silently advancing with zero ports.
   */
  static setupTask(args: SetupTaskArgs, errors?: string[]): TaskPort[] {
    const ports = loadWorkspacePorts(args.worktreePath, errors);
    if (!ports) {
      // Either no .dash/ports.json or invalid. Clear any stale rows from a
      // previous good config, and remove the stale export file so nothing
      // outside Dash sources defunct ports.
      DatabaseService.setTaskPorts(args.taskId, []);
      WorkspacePortsRuntime.removeExportFile(args.worktreePath, DEFAULT_EXPORT_FILE);
      return [];
    }

    const overrides = loadPortOverrides(args.worktreePath);
    const taken = DatabaseService.getTakenHostPorts(args.taskId);
    const hashKey = args.hashKey ?? path.basename(args.worktreePath);
    const assignments = allocatePorts({ ports, worktreeName: hashKey, overrides, taken });

    const persisted = DatabaseService.setTaskPorts(
      args.taskId,
      assignments.map((a) => ({
        label: a.label,
        envVar: a.envVar ?? null,
        defaultPort: a.defaultPort ?? null,
        hostPort: a.hostPort,
        source: a.source,
        runCommand: a.run ?? null,
        stopCommand: a.stop ?? null,
        logsCommand: a.logs ?? null,
        cwd: a.cwd ?? null,
      })),
    );

    const exportFile = ports.exportFile ?? DEFAULT_EXPORT_FILE;
    WorkspacePortsRuntime.writeExportFile(args.worktreePath, exportFile, persisted, ports.derived);
    WorkspacePortsRuntime.ensureGitignoreEntries(args.worktreePath, exportFile);
    return persisted;
  }

  static getPortsForTask(taskId: string): TaskPort[] {
    return DatabaseService.getTaskPorts(taskId);
  }

  /**
   * Full env for a task's worktree: Tier-2 port vars plus the resolved
   * `derived` composites. Shape is `Record<string, string>` so ptyManager can
   * spread it straight into the spawn env.
   */
  static getEnvForTask(taskId: string): Record<string, string> {
    const task = DatabaseService.getTask(taskId);
    if (!task) return {};
    return WorkspacePortsRuntime.buildEnv(task.path, DatabaseService.getTaskPorts(taskId));
  }

  /** Same as getEnvForTask but keyed by worktree path (ptyManager's spawn cwd). */
  static getEnvForWorktree(worktreePath: string): Record<string, string> {
    const task = DatabaseService.getTaskByPath(worktreePath);
    if (!task) return {};
    return WorkspacePortsRuntime.buildEnv(worktreePath, DatabaseService.getTaskPorts(task.id));
  }

  /**
   * Build the worktree's full env from its persisted ports + the `derived`
   * templates in `.dash/ports.json`. The single source both the PTY env and the
   * export file flow through, so they can't disagree. Reloads ports.json each
   * call (cheap; the file is tiny) so a `derived` edit takes effect without
   * re-running allocation.
   */
  private static buildEnv(worktreePath: string, ports: TaskPort[]): Record<string, string> {
    const portEntries = WorkspacePortsRuntime.portEntries(ports);
    // No allocated ports → nothing to inject. Short-circuit before touching the
    // filesystem: it's the common case (most tasks have no ports.json, so this
    // runs on every PTY spawn) and it avoids resolving `derived` templates
    // against missing ports, which would otherwise leak literal `${VAR}` text
    // into the env.
    if (portEntries.length === 0) return {};
    const config = loadWorkspacePorts(worktreePath);
    return Object.fromEntries(composeWorktreeEnv(portEntries, config?.derived));
  }

  /** Ordered [envVar, hostPort] pairs for a task's Tier-2 ports. */
  private static portEntries(ports: TaskPort[]): Array<[string, number]> {
    const entries: Array<[string, number]> = [];
    for (const p of ports) {
      if (p.envVar) entries.push([p.envVar, p.hostPort]);
    }
    return entries;
  }

  /**
   * Write the sourceable export file: `export VAR='…'` lines for every Tier-2
   * port plus the resolved derived vars, in declaration order. Removed instead
   * of written when there's nothing to export. Best-effort — a write failure
   * logs but never blocks setup.
   */
  private static writeExportFile(
    worktreePath: string,
    exportFile: string,
    ports: TaskPort[],
    derived: Record<string, string> | undefined,
  ): void {
    const entries = composeWorktreeEnv(WorkspacePortsRuntime.portEntries(ports), derived);
    if (entries.length === 0) {
      WorkspacePortsRuntime.removeExportFile(worktreePath, exportFile);
      return;
    }
    const target = path.join(worktreePath, exportFile);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, formatEnvExport(entries), 'utf-8');
    } catch (err) {
      console.error(
        `[WorkspacePortsRuntime] Failed to write ${target}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private static removeExportFile(worktreePath: string, exportFile: string): void {
    try {
      fs.rmSync(path.join(worktreePath, exportFile), { force: true });
    } catch {
      /* best effort */
    }
  }

  /**
   * Ensure the worktree's .gitignore ignores Dash's generated per-worktree
   * files (per-dev overrides + the export file) so they never show up in
   * `git status`. Idempotent per line — each required entry is added only if
   * absent, so a worktree onboarded before the export file existed picks it up
   * on the next allocation.
   *
   * Writes to the worktree's own .gitignore (not core.excludesFile) so the
   * addition appears as a normal uncommitted edit the user can see and commit.
   */
  private static ensureGitignoreEntries(worktreePath: string, exportFile: string): void {
    const required = ['.dash/ports.local.json', exportFile];
    const gitignorePath = path.join(worktreePath, GITIGNORE_FILE);

    let existing = '';
    try {
      if (fs.existsSync(gitignorePath)) existing = fs.readFileSync(gitignorePath, 'utf-8');
    } catch (err) {
      console.error(
        `[WorkspacePortsRuntime] Failed to read ${gitignorePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const present = new Set(existing.split('\n').map((l) => l.trim()));
    const missing = required.filter((entry) => !present.has(entry));
    if (missing.length === 0) return;

    // Append: header (only if the section isn't already there) + the missing
    // entries. One blank line of separation from prior content.
    const parts: string[] = [];
    let body = existing;
    if (body.length > 0 && !body.endsWith('\n')) body += '\n';
    if (!body.includes(GITIGNORE_HEADER)) {
      if (body.length > 0 && !body.endsWith('\n\n')) parts.push('');
      parts.push(GITIGNORE_HEADER);
    }
    parts.push(...missing, '');

    try {
      fs.writeFileSync(gitignorePath, body + parts.join('\n'), 'utf-8');
    } catch (err) {
      console.error(
        `[WorkspacePortsRuntime] Failed to write ${gitignorePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
