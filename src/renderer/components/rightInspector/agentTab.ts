/*
 * The task sidebar's Agent tab: what Claude Code keeps beside the code. Its
 * Scratchpad pane is the session's scratchpad folder; its Memory pane the
 * project's auto memory (shared by every worktree of the repo), with the
 * repo's CLAUDE.md files, which Claude Code's docs also count as memory, as a
 * small group of their own.
 */

import { MEMORY_TYPES } from '../../../shared/types';
import type { MemoryEntry, MemoryType, Task } from '../../../shared/types';
import type { TaskScratchpad } from '../../../shared/agent';
import { tildePath } from '../../lib/displayPath';
import { treeOrder } from '../fileTree/treeOrder';

/** The Agent tab's panes. */
export type AgentPane = 'scratchpad' | 'memory';

/**
 * The Scratchpad pane's first line and its tooltip: whose folder it is and
 * when it goes, true to where main found it. A job's `tmp/` goes with the job
 * (`claude rm`): when the task is deleted (a main-checkout task's checkout
 * stays) or its session restarts as a new job. The session's own scratchpad,
 * used only while the task has no job, lives in the system temp folder.
 * Either way it is this session's folder only: a file Claude was told to save
 * elsewhere, another job's folder included, doesn't show.
 */
export function scratchpadScope(
  task: Pick<Task, 'name' | 'useWorktree'>,
  scratchpad: Pick<TaskScratchpad, 'dir' | 'jobId'>,
  home: string,
): { text: string; tooltip: string } {
  const dir = tildePath(scratchpad.dir, home);
  const elsewhere = "Files Claude saves anywhere else, even in another job's folder, don't show.";
  if (scratchpad.jobId) {
    const deleted = task.useWorktree
      ? 'when the task is deleted'
      : 'when the task is deleted (the main checkout stays)';
    return {
      text: `Goes with the session · job ${scratchpad.jobId}`,
      tooltip: `Claude Code's scratch folder for ${task.name}'s session, ${dir}. It stays while the task sleeps and goes with job ${scratchpad.jobId}: ${deleted}, or when its session restarts as a new job. ${elsewhere}`,
    };
  }
  return {
    text: `In the system temp folder · ${task.name}'s session`,
    tooltip: `Claude Code's scratchpad for ${task.name}'s last session, ${dir}. ${task.name} has no background job now, so this is the session's own folder, kept in the system temp folder rather than with the task. ${elsewhere}`,
  };
}

/** One type's memories, as the Memory pane lists them. */
export interface MemoryGroup {
  type: MemoryType;
  entries: MemoryEntry[];
}

/** The memories by type, in `MEMORY_TYPES`' order (standing rules first, untyped last), each by name; no empty groups. */
export function memoryGroups(entries: readonly MemoryEntry[]): MemoryGroup[] {
  return MEMORY_TYPES.map((type) => ({
    type,
    entries: entries
      .filter((e) => e.type === type)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  })).filter((g) => g.entries.length > 0);
}

/** The instruction files Claude Code loads as memory, in the order it reads
 *  them within a folder (code.claude.com/docs/en/memory). */
const INSTRUCTION_NAMES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
/** Nested task worktrees are other checkouts, not this one's files. */
const WORKTREES = /(^|\/)\.claude\/worktrees\//;

/** `path`'s folder and its rank there, when it is an instruction file. */
function instructionAt(path: string): { folder: string; rank: number } | null {
  // `.claude/CLAUDE.md` also ends in `/CLAUDE.md`: the longer name first.
  const byLength = [...INSTRUCTION_NAMES.entries()].sort(([, a], [, b]) => b.length - a.length);
  for (const [rank, name] of byLength) {
    if (path === name) return { folder: '', rank };
    if (path.endsWith(`/${name}`)) return { folder: path.slice(0, -name.length - 1), rank };
  }
  return null;
}

/** The repo's CLAUDE.md files among `paths`: the root's first, then by folder. */
export function instructionFiles(paths: readonly string[]): string[] {
  const found = paths.flatMap((path) => {
    const at = WORKTREES.test(path) ? null : instructionAt(path);
    return at ? [{ path, ...at }] : [];
  });
  const depth = (folder: string) => (folder ? folder.split('/').length : 0);
  return found
    .sort(
      (a, b) =>
        depth(a.folder) - depth(b.folder) ||
        (a.folder === b.folder ? a.rank - b.rank : treeOrder(a.folder, b.folder)),
    )
    .map((f) => f.path);
}
