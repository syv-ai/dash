import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_TYPES,
} from '../../../shared/types';
import type { MemoryEntry, MemoryType, ProjectMemory } from '../../../shared/types';
import { mapMemoryRefs, mapWholeMemoryLinks, resolveMemoryRef } from '../../../shared/memoryLinks';

/** Href prefix the preview intercepts to open another memory in the modal. */
export const MEMORY_LINK_PREFIX = '#memory:';

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  other: 'Untyped',
};

/** A type a memory can be filed under: `other` means "none", so it isn't one. */
export type KnownMemoryType = Exclude<MemoryType, 'other'>;

export const KNOWN_MEMORY_TYPES = MEMORY_TYPES.filter((t): t is KnownMemoryType => t !== 'other');

/** The list's top level: every memory, or one type. */
export type MemoryFilter = 'all' | KnownMemoryType;

/**
 * What is off about a memory: Claude won't recall it, it has no type to be filed under, or it
 * points at nothing. `unwritten` is the mild one, a `[[name]]` no memory
 * answers to yet: Claude leaves those on purpose, for a memory worth writing later.
 */
export type MemoryIssue = 'unindexed' | 'not-loaded' | 'untyped' | 'dead-link' | 'unwritten';

export const MEMORY_ISSUE_LABELS: Record<MemoryIssue, string> = {
  unindexed: 'not indexed',
  'not-loaded': 'past index limit',
  untyped: 'untyped',
  'dead-link': 'dead link',
  unwritten: 'unwritten link',
};

/** How much of the index Claude loads, as the modal says it. */
export const MEMORY_INDEX_LIMIT = `${MEMORY_INDEX_MAX_LINES} lines or ${MEMORY_INDEX_MAX_BYTES / 1000}KB`;

/** A cross-reference that opens nothing. */
export interface BrokenLink {
  /** A `[[name]]` with no memory of that name, or a link to a `file` that isn't there. */
  kind: 'ref' | 'file';
  /** The name as written (trimmed), or the file linked. */
  target: string;
}

export interface ListedMemory {
  entry: MemoryEntry;
  issues: MemoryIssue[];
  broken: BrokenLink[];
}

/** Whether a memory belongs under "Needs attention": an unwritten link alone is no fault. */
export function needsAttention(memory: ListedMemory): boolean {
  return memory.issues.some((i) => i !== 'unwritten');
}

/**
 * The list's second level. Under one type a memory is filed by state: needing
 * attention, changed lately, or older. Under "all", by type instead, with the
 * ones needing attention pulled out on top.
 */
export type MemorySectionId = 'attention' | 'recent' | 'older' | KnownMemoryType;

export interface MemorySection {
  id: MemorySectionId;
  entries: ListedMemory[];
}

export const MEMORY_SECTION_LABELS: Record<MemorySectionId, string> = {
  attention: 'Needs attention',
  recent: 'Recent',
  older: 'Older',
  feedback: MEMORY_TYPE_LABELS.feedback,
  user: MEMORY_TYPE_LABELS.user,
  reference: MEMORY_TYPE_LABELS.reference,
  project: MEMORY_TYPE_LABELS.project,
};

/** Sections that start closed: the long tail, out of the way until asked for. */
export const COLLAPSED_SECTIONS: ReadonlySet<MemorySectionId> = new Set(['older']);

/** How long after its last change a memory still counts as recent. */
export const MEMORY_RECENT_MS = 30 * 24 * 60 * 60 * 1000;

function matchesQuery(entry: MemoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [entry.name, entry.description, entry.body].some((f) => f.toLowerCase().includes(q));
}

/**
 * The cross-references in `body` that open nothing, each once, `[[names]]`
 * first: by the preview's own rule for a working link.
 */
export function brokenLinks(body: string, entries: MemoryEntry[]): BrokenLink[] {
  const files = new Set(entries.map((e) => e.file));
  const resolve = resolveMemoryRef(entries);
  const broken = new Map<string, BrokenLink>();
  const add = (kind: BrokenLink['kind'], target: string) => {
    const key = `${kind}:${target}`;
    if (!broken.has(key)) broken.set(key, { kind, target });
  };
  mapMemoryRefs(body, (ref, match) => {
    if (resolve(ref) === undefined) add('ref', ref.trim());
    return match;
  });
  mapWholeMemoryLinks(body, (file, _text, match) => {
    if (!files.has(file) && file !== MEMORY_INDEX_FILE) add('file', file);
    return match;
  });
  return [...broken.values()];
}

/** Each memory with what is off about it. */
export function listMemories(entries: MemoryEntry[]): ListedMemory[] {
  return entries.map((entry) => {
    const broken = brokenLinks(entry.body, entries);
    const issues: MemoryIssue[] = [];
    if (!entry.inIndex) issues.push('unindexed');
    if (entry.pastIndexLimit) issues.push('not-loaded');
    if (entry.type === 'other') issues.push('untyped');
    if (broken.some((l) => l.kind === 'file')) issues.push('dead-link');
    if (broken.some((l) => l.kind === 'ref')) issues.push('unwritten');
    return { entry, issues, broken };
  });
}

/** What is off about `memory`, a sentence each: shown above it, where the list only flags it. */
export function memoryIssueTexts({ issues, broken }: ListedMemory): string[] {
  const texts: string[] = [];
  if (issues.includes('unindexed')) {
    texts.push(`Not in ${MEMORY_INDEX_FILE}, so Claude never recalls it.`);
  }
  if (issues.includes('not-loaded')) {
    texts.push(`Its line sits past the part of ${MEMORY_INDEX_FILE} Claude loads.`);
  }
  if (issues.includes('untyped')) texts.push("No known type, so it isn't filed with the rest.");
  for (const link of broken) {
    texts.push(
      link.kind === 'ref'
        ? `[[${link.target}]] has no memory yet.`
        : `Links to ${link.target}, which doesn't exist.`,
    );
  }
  return texts;
}

/** How many memories match `query` under each filter. */
export function memoryCounts(entries: MemoryEntry[], query: string): Record<MemoryFilter, number> {
  const matches = entries.filter((e) => matchesQuery(e, query));
  const counts: Record<MemoryFilter, number> = {
    all: matches.length,
    feedback: 0,
    user: 0,
    reference: 0,
    project: 0,
  };
  for (const e of matches) if (e.type !== 'other') counts[e.type]++;
  return counts;
}

/**
 * The `memories` (see listMemories) under `filter` matching `query`, each in exactly one section,
 * newest first; empty sections are dropped. An untyped memory has no type to
 * be filed under, so it only shows under "all", as needing attention. A memory
 * whose only issue is an unwritten link stays where it would be without it.
 */
export function memorySections(
  memories: ListedMemory[],
  filter: MemoryFilter,
  query: string,
  nowMs: number,
): MemorySection[] {
  const listed = memories
    .filter((m) => matchesQuery(m.entry, query))
    .filter((m) => filter === 'all' || m.entry.type === filter)
    .sort((a, b) => b.entry.mtimeMs - a.entry.mtimeMs);
  const fine = listed.filter((m) => !needsAttention(m));
  const isRecent = (m: ListedMemory) => nowMs - m.entry.mtimeMs <= MEMORY_RECENT_MS;
  const sections: MemorySection[] = [
    { id: 'attention', entries: listed.filter(needsAttention) },
    ...(filter === 'all'
      ? // KNOWN_MEMORY_TYPES is the display order, so a new type can't be left out of the list.
        KNOWN_MEMORY_TYPES.map((type) => ({
          id: type,
          entries: fine.filter((m) => m.entry.type === type),
        }))
      : [
          { id: 'recent' as const, entries: fine.filter(isRecent) },
          { id: 'older' as const, entries: fine.filter((m) => !isRecent(m)) },
        ]),
  ];
  return sections.filter((s) => s.entries.length > 0);
}

/**
 * What the modal says above the list when the index and what Claude sees have
 * come apart: auto memory is off, the index has outgrown what a session
 * loads, or it points at memories that are gone.
 */
export function memoryNotices(memory: ProjectMemory): string[] {
  const notices: string[] = [];
  if (memory.disabledBy) {
    notices.push(
      `Auto memory is off for this project (${memory.disabledBy}): Claude neither loads nor adds to these memories.`,
    );
  }
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

/**
 * The chosen memory while it exists, else the first as "all" lists them: what
 * the modal shows of `memories` (see listMemories).
 */
export function pickCurrent(
  memories: ListedMemory[],
  selectedFile: string | null,
): ListedMemory | null {
  return (
    memories.find((m) => m.entry.file === selectedFile) ??
    memorySections(memories, 'all', '', 0)[0]?.entries[0] ??
    null
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Point memory cross-references at `#memory:<file>` so the preview can route
 * clicks back into the modal. `[[name]]` resolves by frontmatter name, then by
 * basename (see resolveMemoryRef); a memory link (see mapWholeMemoryLinks) is
 * rewritten when its file exists and left as written when it is MEMORY.md. Any
 * other points at nothing and is shown as muted text, not a link: followed, a
 * dead file link would only hand the browser a file that isn't there.
 */
export function rewriteMemoryLinks(markdown: string, entries: MemoryEntry[]): string {
  const files = new Set(entries.map((e) => e.file));
  const resolve = resolveMemoryRef(entries);

  const missing = (text: string) => `<span class="memory-missing">${escapeHtml(text)}</span>`;
  const open = (text: string, file: string) =>
    `[${text}](${MEMORY_LINK_PREFIX}${encodeURIComponent(file)})`;
  const refsDone = mapMemoryRefs(markdown, (ref) => {
    const file = resolve(ref);
    return file ? open(ref, file) : missing(ref);
  });
  return mapWholeMemoryLinks(refsDone, (file, text, match) => {
    if (files.has(file)) return open(text, file);
    return file === MEMORY_INDEX_FILE ? match : missing(text);
  });
}

/**
 * The preview frame's sandbox. It must never gain `allow-scripts`: with
 * `allow-same-origin` that would let untrusted memory HTML script the renderer
 * (and `window.electronAPI`). Same-origin is what lets MemoryPreview wire the
 * frame's links and Esc from outside; `allow-popups` lets `<base target=_blank>`
 * links reach the window-open handler.
 */
export const MEMORY_PREVIEW_SANDBOX = 'allow-same-origin allow-popups';

/**
 * Injected into the preview document's <head>. `<base target=_blank>` sends
 * ordinary links to the window-open handler (→ system browser); memory links
 * are intercepted by MemoryPreview before that happens. Also styles
 * `.memory-missing`, the span rewriteMemoryLinks writes for a link that points
 * at nothing.
 */
export const MEMORY_PREVIEW_HEAD = `<base target="_blank" />
<style>.memory-missing{opacity:.55;text-decoration:underline dotted}</style>`;
