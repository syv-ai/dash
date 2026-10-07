import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_TYPES,
} from '../../../shared/types';
import type { MemoryEntry, MemoryFields, MemoryType, ProjectMemory } from '../../../shared/types';
import {
  mapMemoryLinks,
  mapMemoryRefs,
  mapWholeMemoryLinks,
  memoryLinkFiles,
  memoryLinkTarget,
} from '../../../shared/memoryLinks';

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

/**
 * What is off about a memory: Claude won't recall it, can't file it, or it
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

/** A cross-reference that opens nothing. */
export interface BrokenLink {
  /** A `[[name]]` with no memory of that name, or a link to a `file` that isn't there. */
  kind: 'ref' | 'file';
  /** The name as written (trimmed), or the file linked. */
  target: string;
  /** The file of the memory it most likely meant, when one comes close. */
  suggestion?: string;
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

/** A name or file as compared when guessing what a broken link meant: letters and digits only. */
function linkKey(text: string): string {
  return text
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Whether two keys are one slip apart: a character added, dropped or swapped for another. */
function oneSlipApart(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  const rest = short.length === long.length ? i + 1 : i;
  return short.slice(rest) === long.slice(i + 1);
}

/**
 * The memory a broken link to `target` most likely meant: one whose name or
 * file says the same but for case and punctuation, else contains it or is
 * contained in it, else is one slip away. Undefined when nothing comes close.
 */
function suggestMemory(target: string, entries: MemoryEntry[]): string | undefined {
  const key = linkKey(target);
  // Too short to tell a near miss from another word.
  if (key.length < 4) return undefined;
  const keyed = entries.map((e) => ({ file: e.file, keys: [linkKey(e.name), linkKey(e.file)] }));
  const tests: ((k: string) => boolean)[] = [
    (k) => k === key,
    (k) => k.length >= 4 && (k.includes(key) || key.includes(k)),
    (k) => oneSlipApart(k, key),
  ];
  for (const test of tests) {
    const hit = keyed.find((e) => e.keys.some(test));
    if (hit) return hit.file;
  }
  return undefined;
}

/**
 * The cross-references in `body` that open nothing, each once, `[[names]]`
 * first: by the preview's own rule for a working link. `self` is the file
 * `body` belongs to, which a link is never guessed to have meant.
 */
export function brokenLinks(body: string, entries: MemoryEntry[], self?: string): BrokenLink[] {
  const files = new Set(entries.map((e) => e.file));
  const resolve = refResolver(entries);
  const others = entries.filter((e) => e.file !== self);
  const broken = new Map<string, BrokenLink>();
  const add = (kind: BrokenLink['kind'], target: string) => {
    const key = `${kind}:${target}`;
    if (!broken.has(key))
      broken.set(key, { kind, target, suggestion: suggestMemory(target, others) });
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
    const broken = brokenLinks(entry.body, entries, entry.file);
    const issues: MemoryIssue[] = [];
    if (!entry.inIndex) issues.push('unindexed');
    if (entry.pastIndexLimit) issues.push('not-loaded');
    if (entry.type === 'other') issues.push('untyped');
    if (broken.some((l) => l.kind === 'file')) issues.push('dead-link');
    if (broken.some((l) => l.kind === 'ref')) issues.push('unwritten');
    return { entry, issues, broken };
  });
}

/**
 * `body` with a broken link pointed at the memory `to` instead: a `[[name]]`
 * by the name that memory answers to, a file link by its file.
 */
export function repointLink(
  body: string,
  link: BrokenLink,
  to: MemoryEntry,
  entries: MemoryEntry[],
): string {
  if (link.kind === 'file') {
    return mapMemoryLinks(body, (file, match) =>
      file === link.target ? `](${memoryLinkTarget(to.file)})` : match,
    );
  }
  // Its basename, when its name can't be written as a link or means another memory.
  const named = !to.name.includes(']') && refResolver(entries)(to.name) === to.file;
  const name = named ? to.name : to.file.replace(/\.md$/, '');
  return mapMemoryRefs(body, (ref, match) => (ref.trim() === link.target ? `[[${name}]]` : match));
}

/** `body` with a broken link left as the plain text it showed. */
export function unlinkLink(body: string, link: BrokenLink): string {
  if (link.kind === 'file') {
    return mapWholeMemoryLinks(body, (file, text, match) => (file === link.target ? text : match));
  }
  return mapMemoryRefs(body, (ref, match) => (ref.trim() === link.target ? ref.trim() : match));
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
 * be filed under, so it only shows under "all", as needing attention. A memory
 * whose only issue is an unwritten link stays where it would be without it.
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

export interface MemoryNotice {
  text: string;
  /** What the modal can do about it: `prune` drops the index's dangling lines. */
  action?: 'prune';
}

/**
 * What the modal says above the list when the index and what Claude sees have
 * come apart: auto memory is off, the index has outgrown what a session
 * loads, or it points at memories that are gone.
 */
export function memoryNotices(memory: ProjectMemory): MemoryNotice[] {
  const notices: MemoryNotice[] = [];
  if (memory.disabledBy) {
    notices.push({
      text: `Auto memory is off for this project (${memory.disabledBy}): Claude neither loads nor adds to these memories.`,
    });
  }
  const cut = memory.entries.filter((e) => e.pastIndexLimit).length;
  if (cut > 0) {
    notices.push({
      text: `${MEMORY_INDEX_FILE} is over the ${MEMORY_INDEX_MAX_LINES} lines or ${MEMORY_INDEX_MAX_BYTES / 1000}KB Claude loads into a session: ${cut} ${cut === 1 ? 'memory sits' : 'memories sit'} past the cut and ${cut === 1 ? "isn't" : "aren't"} seen. Shorten the hooks or drop stale lines.`,
    });
  }
  const gone = memory.dangling;
  if (gone.length > 0) {
    notices.push({
      text: `${MEMORY_INDEX_FILE} points at ${gone.length === 1 ? 'a memory that no longer exists' : `${gone.length} memories that no longer exist`}: ${gone.join(', ')}.`,
      action: 'prune',
    });
  }
  return notices;
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

/** What the editor edits: the memory file's fields, and its MEMORY.md line's hook. */
export type MemoryDraftFields = MemoryFields & { hook: string };

/**
 * The memory's line in MEMORY.md: its `own` (the hook is editable), `missing`
 * (a save adds one), or `fixed`: shared with another link, or its own but not
 * in the shape Claude writes, so not ours to reword.
 */
export type MemoryDraftLine = 'own' | 'missing' | 'fixed';

/** What the editor's hook field says while empty. */
export const MEMORY_HOOK_PLACEHOLDERS: Record<MemoryDraftLine, string> = {
  own: 'No hook: Claude sees only the title until it opens the memory',
  missing: 'Same as the description, unless you write one',
  fixed: `Its ${MEMORY_INDEX_FILE} line is shared or in another shape: edit the index by hand`,
};

/** An unsaved create or edit. */
export interface MemoryDraft {
  /** The file being edited and the stat it was read at (the save's overwrite
   *  guard); null for a memory that doesn't exist yet. */
  target: { file: string; mtimeMs: number; sizeBytes: number } | null;
  line: MemoryDraftLine;
  /** What `fields` started as: the draft is dirty once they differ. */
  saved: MemoryDraftFields;
  fields: MemoryDraftFields;
}

const FIELD_KEYS = ['name', 'description', 'hook', 'type', 'body'] as const;

/**
 * What a new memory of `type` starts with. Feedback and project memories carry
 * their reasoning, so Claude can judge when one still applies.
 */
export function memoryScaffold(type: MemoryType): string {
  return type === 'feedback' || type === 'project' ? '\n\n**Why:** \n\n**How to apply:** ' : '';
}

/** A new memory's draft. `name` is given when it is written to answer a `[[name]]`. */
export function newMemoryDraft(type: KnownMemoryType = 'project', name = ''): MemoryDraft {
  const fields: MemoryDraftFields = {
    name,
    description: '',
    hook: '',
    type,
    body: memoryScaffold(type),
  };
  return { target: null, line: 'missing', saved: fields, fields };
}

/** `draft`'s fields as `type`. A new memory's untouched scaffold follows the type. */
export function retypeDraft(draft: MemoryDraft, type: MemoryType): MemoryDraftFields {
  const { fields } = draft;
  const untouched = !draft.target && fields.body === memoryScaffold(fields.type);
  return { ...fields, type, body: untouched ? memoryScaffold(type) : fields.body };
}

export function editMemoryDraft(entry: MemoryEntry): MemoryDraft {
  const fields: MemoryDraftFields = {
    name: entry.name,
    description: entry.description,
    hook: entry.hook ?? '',
    type: entry.type,
    // The blank line after the frontmatter and the final newline belong to the file.
    body: entry.body.trim(),
  };
  return {
    target: { file: entry.file, mtimeMs: entry.mtimeMs, sizeBytes: entry.sizeBytes },
    line: entry.hook !== null ? 'own' : entry.inIndex ? 'fixed' : 'missing',
    saved: fields,
    fields,
  };
}

export function isDraftDirty(draft: MemoryDraft): boolean {
  const { fields } = draft;
  // A new memory has nothing to lose until something is written: picking a type isn't that.
  if (!draft.target) {
    return (
      fields.name !== '' ||
      fields.description !== '' ||
      fields.hook !== '' ||
      fields.body !== memoryScaffold(fields.type)
    );
  }
  return FIELD_KEYS.some((k) => fields[k] !== draft.saved[k]);
}

/**
 * `draft`'s fields with a new description. A hook that says what the
 * description says (as one Dash wrote does) is moved along with it, in view.
 */
export function redescribeDraft(draft: MemoryDraft, description: string): MemoryDraftFields {
  const { fields } = draft;
  const mirrors = draft.line === 'own' && fields.hook !== '' && fields.hook === fields.description;
  return { ...fields, description, hook: mirrors ? description : fields.hook };
}

/**
 * The hook a save should write on the memory's MEMORY.md line, or undefined to
 * leave the line's hook as it is: when it isn't ours to reword, and when it
 * wasn't edited (Claude may have reworded it since the draft was opened). For
 * a line that doesn't exist yet only a written hook is sent: the save gives a
 * new line the description, and leaves one Claude added meanwhile alone.
 */
export function draftHook(draft: MemoryDraft): string | undefined {
  const hook = draft.fields.hook.trim();
  if (draft.line === 'missing') return hook || undefined;
  if (draft.line === 'fixed' || hook === draft.saved.hook) return undefined;
  return hook;
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
 * basename; memory links (see mapMemoryLinks) are rewritten only when that file
 * exists. What points at nothing is shown as muted text, not a link: followed,
 * a dead file link would only hand the browser a file that isn't there.
 */
export function rewriteMemoryLinks(markdown: string, entries: MemoryEntry[]): string {
  const files = new Set(entries.map((e) => e.file));
  const resolve = refResolver(entries);

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
