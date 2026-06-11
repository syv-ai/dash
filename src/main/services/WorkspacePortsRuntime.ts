import * as fs from 'fs';
import * as path from 'path';
import { loadWorkspacePorts, loadPortOverrides } from './WorkspacePortsService';
import { allocatePorts } from './PortAllocator';
import { DatabaseService } from './DatabaseService';
import type { TaskPort } from '@shared/types';

const GITIGNORE_FILE = '.gitignore';

// Header marker is the idempotency check — if the file already contains
// this exact line we skip the append so multiple worktree creations don't
// stack duplicate sections. The wording also tells humans who notice the
// section that they shouldn't edit it by hand.
const GITIGNORE_HEADER = '# Dash — port management (generated per-worktree; do not commit)';
const GITIGNORE_ENTRIES = ['.dash/ports.local.json', '.dash/setup-complete'];

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
 *   persist to task_ports.
 *
 * The DB is the single source of truth: Dash's PTY spawn reads the env from
 * the DB at spawn time. Nothing else needs the allocations on disk — the
 * "outside Dash = defaults" contract (see PortsSetupPrompt) means no tool
 * is supposed to source a `.env` mirror.
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
      // previous good config so the task doesn't keep ghost assignments.
      DatabaseService.setTaskPorts(args.taskId, []);
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

    WorkspacePortsRuntime.ensureGitignoreEntries(args.worktreePath);
    return persisted;
  }

  static getPortsForTask(taskId: string): TaskPort[] {
    return DatabaseService.getTaskPorts(taskId);
  }

  /**
   * `KEY=VALUE` env lookup for a task's Tier 2 ports. Returned shape is
   * `Record<string, string>` so ptyManager can spread it directly into the
   * spawn env without type juggling.
   */
  static getEnvForTask(taskId: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const p of DatabaseService.getTaskPorts(taskId)) {
      if (p.envVar) env[p.envVar] = String(p.hostPort);
    }
    return env;
  }

  /** Same as getEnvForTask but looks up the task by worktree path. */
  static getEnvForWorktree(worktreePath: string): Record<string, string> {
    const task = DatabaseService.getTaskByPath(worktreePath);
    if (!task) return {};
    return WorkspacePortsRuntime.getEnvForTask(task.id);
  }

  /**
   * Append the Dash-managed local-files section to the worktree's
   * .gitignore so per-dev overrides + the completion sentinel don't show up
   * in `git status`. Idempotent via the header marker — re-running on every
   * task creation is a no-op once the section is already there.
   *
   * Writes to the worktree's own .gitignore so the change appears as a
   * normal uncommitted edit in the setup task's diff — the user sees what
   * Dash added and commits it as part of "set up port management." A
   * shared `core.excludesFile` would hide the addition, which we don't
   * want.
   */
  private static ensureGitignoreEntries(worktreePath: string): void {
    const gitignorePath = path.join(worktreePath, GITIGNORE_FILE);
    let existing = '';
    try {
      if (fs.existsSync(gitignorePath)) {
        existing = fs.readFileSync(gitignorePath, 'utf-8');
      }
    } catch (err) {
      console.error(
        `[WorkspacePortsRuntime] Failed to read ${gitignorePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (existing.includes(GITIGNORE_HEADER)) return;

    // One blank line of separation from whatever came before (if anything),
    // then header + entries + trailing newline. POSIX convention: text
    // files end with a newline.
    const separator =
      existing.length === 0
        ? ''
        : existing.endsWith('\n\n')
          ? ''
          : existing.endsWith('\n')
            ? '\n'
            : '\n\n';
    const section = [GITIGNORE_HEADER, ...GITIGNORE_ENTRIES, ''].join('\n');

    try {
      fs.writeFileSync(gitignorePath, existing + separator + section, 'utf-8');
    } catch (err) {
      console.error(
        `[WorkspacePortsRuntime] Failed to write ${gitignorePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
