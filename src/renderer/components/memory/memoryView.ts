import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
} from '../../../shared/types';
import type { MemoryEntry, MemoryType, ProjectMemory, Task } from '../../../shared/types';

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  other: 'Untyped',
};

/** What is off about a memory: Claude won't recall it, or it has no type to be filed under. */
export type MemoryIssue = 'unindexed' | 'not-loaded' | 'untyped';

export const MEMORY_ISSUE_LABELS: Record<MemoryIssue, string> = {
  unindexed: 'not indexed',
  'not-loaded': 'past index limit',
  untyped: 'untyped',
};

/** How much of the index Claude loads, in words. */
export const MEMORY_INDEX_LIMIT = `${MEMORY_INDEX_MAX_LINES} lines or ${MEMORY_INDEX_MAX_BYTES / 1000}KB`;

export interface ListedMemory {
  entry: MemoryEntry;
  issues: MemoryIssue[];
}

/** Whether a memory's name, description or text holds `query` (none: every memory does). */
export function memoryMatches(entry: MemoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [entry.name, entry.description, entry.body].some((f) => f.toLowerCase().includes(q));
}

/** Each memory with what is off about it. */
export function listMemories(entries: MemoryEntry[]): ListedMemory[] {
  return entries.map((entry) => {
    const issues: MemoryIssue[] = [];
    if (!entry.inIndex) issues.push('unindexed');
    if (entry.pastIndexLimit) issues.push('not-loaded');
    if (entry.type === 'other') issues.push('untyped');
    return { entry, issues };
  });
}

/** What is off about `memory`, a sentence each: its row's tooltip, where the row only flags it. */
export function memoryIssueTexts({ issues }: ListedMemory): string[] {
  const texts: string[] = [];
  if (issues.includes('unindexed')) {
    texts.push(`Not in ${MEMORY_INDEX_FILE}, so Claude never recalls it.`);
  }
  if (issues.includes('not-loaded')) {
    texts.push(`Its line sits past the part of ${MEMORY_INDEX_FILE} Claude loads.`);
  }
  if (issues.includes('untyped')) texts.push("No known type, so it isn't filed with the rest.");
  return texts;
}

/**
 * What the Memory pane says above the list when the index and what Claude sees have
 * come apart: the index has outgrown what a session loads, or it points at
 * memories that are gone.
 */
export function memoryNotices(memory: ProjectMemory): string[] {
  const notices: string[] = [];
  const cut = memory.entries.filter((e) => e.pastIndexLimit).length;
  if (cut > 0) {
    notices.push(
      `${MEMORY_INDEX_FILE} is over the ${MEMORY_INDEX_LIMIT} Claude loads into a session: ${cut} ${cut === 1 ? 'memory sits' : 'memories sit'} past the cut and ${cut === 1 ? "isn't" : "aren't"} seen. Shorten the hooks or drop stale lines.`,
    );
  }
  const gone = memory.dangling;
  if (gone.length > 0) {
    notices.push(
      `${MEMORY_INDEX_FILE} points at ${gone.length === 1 ? 'a memory that no longer exists' : `${gone.length} memories that no longer exist`}: ${gone.join(', ')}.`,
    );
  }
  return notices;
}

/** The project row badge's tooltip. */
export function newMemoriesLabel(count: number): string {
  return `${count} new ${count === 1 ? 'memory' : 'memories'}`;
}

/**
 * The task whose Agent tab shows a project's memory, asked for from the
 * project (its menu, its new-memory count): the active task when it is one of
 * the project's, else its first open task in the project's task order;
 * null when the project has none. Every task of a repo shares one memory.
 */
export function memoryTaskOf(
  projectTasks: readonly Task[],
  activeTaskId: string | null,
): Task | null {
  const open = projectTasks.filter((t) => !t.archivedAt);
  return open.find((t) => t.id === activeTaskId) ?? open[0] ?? null;
}

/**
 * What "Mention in prompt" types into the prompt: an @-mention of the file, unsent,
 * ready for more. A path with whitespace goes in quotes (`@"…"`), the form
 * Claude Code reads a spaced path from.
 */
export function memoryMention(path: string): string {
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `;
}
