import { MEMORY_INDEX_FILE, MEMORY_TYPES } from '../../../shared/types';
import type { MemoryEntry, MemoryFields, MemoryType, ProjectMemory } from '../../../shared/types';
import { mapMemoryLinks, mapMemoryRefs, memoryLinkFiles } from '../../../shared/memoryLinks';

/** Href prefix the preview intercepts to open another memory in the modal. */
export const MEMORY_LINK_PREFIX = '#memory:';

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  other: 'Untyped',
};

/** What belongs under each type: shown beside the editor's type picker. */
export const MEMORY_TYPE_HINTS: Record<MemoryType, string> = {
  feedback: 'How Claude should work: corrections and confirmed approaches, with the why.',
  user: 'Who you are: role, expertise and preferences.',
  reference: 'Pointers to external resources: URLs, dashboards, tickets.',
  project: "Ongoing work, goals and constraints the code and git history don't record.",
  other: 'No known type. Pick one so the memory is filed with the rest.',
};

/** A type a memory can be filed under: `other` means "none", so it isn't one. */
export type KnownMemoryType = Exclude<MemoryType, 'other'>;

export const KNOWN_MEMORY_TYPES = MEMORY_TYPES.filter((t): t is KnownMemoryType => t !== 'other');

/** The list's top level: every memory, or one type. */
export type MemoryFilter = 'all' | KnownMemoryType;

/** Why a memory needs a look: Claude won't recall it, can't file it, or it points at nothing. */
export type MemoryIssue = 'unindexed' | 'untyped' | 'dead-link';

export const MEMORY_ISSUE_LABELS: Record<MemoryIssue, string> = {
  unindexed: 'not indexed',
  untyped: 'untyped',
  'dead-link': 'dead link',
};

export interface ListedMemory {
  entry: MemoryEntry;
  issues: MemoryIssue[];
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

/** Each memory with what is wrong with it, by the preview's own rule for a working link. */
export function listMemories(entries: MemoryEntry[]): ListedMemory[] {
  const files = new Set(entries.map((e) => e.file));
  const resolve = refResolver(entries);
  return entries.map((entry) => {
    let dead = false;
    mapMemoryRefs(entry.body, (ref, match) => {
      dead ||= resolve(ref) === undefined;
      return match;
    });
    mapMemoryLinks(entry.body, (file, match) => {
      dead ||= !files.has(file) && file !== MEMORY_INDEX_FILE;
      return match;
    });
    const issues: MemoryIssue[] = [];
    if (!entry.inIndex) issues.push('unindexed');
    if (entry.type === 'other') issues.push('untyped');
    if (dead) issues.push('dead-link');
    return { entry, issues };
  });
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
 * The memories under `filter` matching `query`, each in exactly one section,
 * newest first; empty sections are dropped. An untyped memory has no type to
 * be filed under, so it only shows under "all", as needing attention.
 */
export function memorySections(
  entries: MemoryEntry[],
  filter: MemoryFilter,
  query: string,
  nowMs: number,
): MemorySection[] {
  const listed = listMemories(entries)
    .filter((m) => matchesQuery(m.entry, query))
    .filter((m) => filter === 'all' || m.entry.type === filter)
    .sort((a, b) => b.entry.mtimeMs - a.entry.mtimeMs);
  const fine = listed.filter((m) => m.issues.length === 0);
  const isRecent = (m: ListedMemory) => nowMs - m.entry.mtimeMs <= MEMORY_RECENT_MS;
  const sections: MemorySection[] = [
    { id: 'attention', entries: listed.filter((m) => m.issues.length > 0) },
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

/** What the modal previews: a memory, or the MEMORY.md index (untyped). */
export interface MemoryDoc {
  key: string;
  file: string;
  title: string;
  markdown: string;
  type?: MemoryType;
  description?: string;
  /** The memory behind this doc. Absent for the index: Dash keeps it in step, it isn't edited here. */
  entry?: MemoryEntry;
}

/**
 * The memories and the index as one uniform list, so the modal never branches
 * on "is this the index?". Order is the fallback order: memories as "all"
 * lists them, then the index, which is what an index-only folder shows.
 */
export function memoryDocs(memory: ProjectMemory): MemoryDoc[] {
  const docs: MemoryDoc[] = memorySections(memory.entries, 'all', '', 0).flatMap((section) =>
    section.entries.map(({ entry: e }) => ({
      key: e.file,
      file: e.file,
      title: e.name,
      markdown: e.body,
      type: e.type,
      description: e.description,
      entry: e,
    })),
  );
  if (memory.index != null) {
    docs.push({
      key: MEMORY_INDEX_FILE,
      file: MEMORY_INDEX_FILE,
      title: 'Index',
      markdown: memory.index,
    });
  }
  return docs;
}

/** The chosen doc while it exists, else the first in fallback order. */
export function pickCurrent(docs: MemoryDoc[], selectedKey: string | null): MemoryDoc | null {
  return docs.find((d) => d.key === selectedKey) ?? docs[0] ?? null;
}

/** An unsaved create or edit. */
export interface MemoryDraft {
  /** The file being edited and the stat it was read at (the save's overwrite
   *  guard); null for a memory that doesn't exist yet. */
  target: { file: string; mtimeMs: number; sizeBytes: number } | null;
  /** What `fields` started as: the draft is dirty once they differ. */
  saved: MemoryFields;
  fields: MemoryFields;
}

const FIELD_KEYS = ['name', 'description', 'type', 'body'] as const;

/**
 * What a new memory of `type` starts with. Feedback and project memories carry
 * their reasoning, so Claude can judge when one still applies.
 */
export function memoryScaffold(type: MemoryType): string {
  return type === 'feedback' || type === 'project' ? '\n\n**Why:** \n\n**How to apply:** ' : '';
}

export function newMemoryDraft(type: KnownMemoryType = 'project'): MemoryDraft {
  const fields: MemoryFields = { name: '', description: '', type, body: memoryScaffold(type) };
  return { target: null, saved: fields, fields };
}

/** `draft`'s fields as `type`. A new memory's untouched scaffold follows the type. */
export function retypeDraft(draft: MemoryDraft, type: MemoryType): MemoryFields {
  const { fields } = draft;
  const untouched = !draft.target && fields.body === memoryScaffold(fields.type);
  return { ...fields, type, body: untouched ? memoryScaffold(type) : fields.body };
}

export function editMemoryDraft(entry: MemoryEntry): MemoryDraft {
  const fields: MemoryFields = {
    name: entry.name,
    description: entry.description,
    type: entry.type,
    // The blank line after the frontmatter and the final newline belong to the file.
    body: entry.body.trim(),
  };
  return {
    target: { file: entry.file, mtimeMs: entry.mtimeMs, sizeBytes: entry.sizeBytes },
    saved: fields,
    fields,
  };
}

export function isDraftDirty(draft: MemoryDraft): boolean {
  const { fields } = draft;
  // A new memory has nothing to lose until something is written: picking a type isn't that.
  if (!draft.target) {
    return (
      fields.name !== '' || fields.description !== '' || fields.body !== memoryScaffold(fields.type)
    );
  }
  return FIELD_KEYS.some((k) => fields[k] !== draft.saved[k]);
}

export function canSaveDraft(draft: MemoryDraft): boolean {
  return draft.fields.name.trim() !== '' && isDraftDirty(draft);
}

/**
 * The types a draft can be saved as. `other` means "no known type", so it is
 * offered only to a memory that already is one (saving it leaves the type alone).
 */
export function draftTypes(draft: MemoryDraft): MemoryType[] {
  return MEMORY_TYPES.filter((t) => t !== 'other' || draft.saved.type === 'other');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Which file a `[[ref]]` means: the memory with that name, else the one with that basename. */
function refResolver(entries: MemoryEntry[]): (ref: string) => string | undefined {
  const byName = new Map(entries.map((e) => [e.name, e.file]));
  const files = new Set(entries.map((e) => e.file));
  return (ref) => {
    const name = ref.trim();
    return byName.get(name) ?? (files.has(`${name}.md`) ? `${name}.md` : undefined);
  };
}

/**
 * The other memories whose text points at `target`, by `[[name]]` or by a
 * link to its file: what a delete would leave dangling.
 */
export function memoryReferrers(entries: MemoryEntry[], target: MemoryEntry): MemoryEntry[] {
  const resolve = refResolver(entries);
  return entries.filter((e) => {
    if (e.file === target.file) return false;
    if (memoryLinkFiles(e.body).has(target.file)) return true;
    let refers = false;
    mapMemoryRefs(e.body, (ref, match) => {
      refers ||= resolve(ref) === target.file;
      return match;
    });
    return refers;
  });
}

/**
 * Point memory cross-references at `#memory:<file>` so the preview can route
 * clicks back into the modal. `[[name]]` resolves by frontmatter name, then by
 * basename; memory links (see mapMemoryLinks) are rewritten only when that file exists.
 */
export function rewriteMemoryLinks(markdown: string, entries: MemoryEntry[]): string {
  const files = new Set(entries.map((e) => e.file));
  const resolve = refResolver(entries);

  return mapMemoryLinks(
    mapMemoryRefs(markdown, (ref) => {
      const file = resolve(ref);
      return file
        ? `[${ref}](${MEMORY_LINK_PREFIX}${encodeURIComponent(file)})`
        : `<span class="memory-missing">${escapeHtml(ref)}</span>`;
    }),
    (file, match) =>
      files.has(file) ? `](${MEMORY_LINK_PREFIX}${encodeURIComponent(file)})` : match,
  );
}

/**
 * Injected into the preview document's <head>. `<base target=_blank>` sends
 * ordinary links to the window-open handler (→ system browser); memory links
 * are intercepted by MemoryPreview before that happens.
 */
/**
 * The preview frame's sandbox. It must never gain `allow-scripts`: with
 * `allow-same-origin` that would let untrusted memory HTML script the renderer
 * (and `window.electronAPI`). Same-origin is what lets MemoryPreview wire the
 * frame's links and Esc from outside; `allow-popups` lets `<base target=_blank>`
 * links reach the window-open handler.
 */
export const MEMORY_PREVIEW_SANDBOX = 'allow-same-origin allow-popups';

export const MEMORY_PREVIEW_HEAD = `<base target="_blank" />
<style>.memory-missing{opacity:.55;text-decoration:underline dotted}</style>`;
