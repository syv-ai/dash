import { MEMORY_INDEX_FILE, MEMORY_TYPES } from '../../../shared/types';
import type { MemoryEntry, MemoryType, ProjectMemory } from '../../../shared/types';
import { mapMemoryLinks } from '../../../shared/memoryLinks';

/** Href prefix the preview intercepts to open another memory in the modal. */
export const MEMORY_LINK_PREFIX = '#memory:';

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
  other: 'Other',
};

export interface MemoryGroup {
  type: MemoryType;
  entries: MemoryEntry[];
}

export function groupMemories(entries: MemoryEntry[], query: string): MemoryGroup[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? entries.filter((e) =>
        [e.name, e.description, e.body].some((f) => f.toLowerCase().includes(q)),
      )
    : entries;
  // MEMORY_TYPES is the display order, so a new type can't be left out of the list.
  return MEMORY_TYPES.map((type) => ({
    type,
    entries: matches.filter((e) => e.type === type).sort((a, b) => b.mtimeMs - a.mtimeMs),
  })).filter((g) => g.entries.length > 0);
}

/** What the modal lists and previews: a memory, or the MEMORY.md index (untyped). */
export interface MemoryDoc {
  key: string;
  file: string;
  title: string;
  markdown: string;
  type?: MemoryType;
  description?: string;
}

/**
 * The index and the memories as one uniform list, so the modal never branches
 * on "is this the index?". Order is the fallback order: the index first, then
 * memories in list order (group order, newest first).
 */
export function memoryDocs(memory: ProjectMemory): MemoryDoc[] {
  const docs: MemoryDoc[] =
    memory.index != null
      ? [
          {
            key: MEMORY_INDEX_FILE,
            file: MEMORY_INDEX_FILE,
            title: 'Index',
            markdown: memory.index,
          },
        ]
      : [];
  for (const group of groupMemories(memory.entries, '')) {
    for (const e of group.entries) {
      docs.push({
        key: e.file,
        file: e.file,
        title: e.name,
        markdown: e.body,
        type: e.type,
        description: e.description,
      });
    }
  }
  return docs;
}

/** The chosen doc while it exists, else the first in fallback order. */
export function pickCurrent(docs: MemoryDoc[], selectedKey: string | null): MemoryDoc | null {
  return docs.find((d) => d.key === selectedKey) ?? docs[0] ?? null;
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
 * basename; memory links (see mapMemoryLinks) are rewritten only when that file exists.
 */
export function rewriteMemoryLinks(markdown: string, entries: MemoryEntry[]): string {
  const byName = new Map(entries.map((e) => [e.name, e.file]));
  const files = new Set(entries.map((e) => e.file));
  const resolve = (ref: string): string | undefined =>
    byName.get(ref) ?? (files.has(`${ref}.md`) ? `${ref}.md` : undefined);

  return mapMemoryLinks(
    markdown.replace(/\[\[([^\]\n]+)\]\]/g, (_m, ref: string) => {
      const file = resolve(ref.trim());
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
