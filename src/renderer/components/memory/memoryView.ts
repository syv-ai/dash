import { MEMORY_INDEX_FILE, MEMORY_TYPES } from '../../../shared/types';
import type { MemoryEntry, MemoryType, ProjectMemory } from '../../../shared/types';

/** Href prefix the preview iframe intercepts and posts back to the modal. */
export const MEMORY_LINK_PREFIX = '#memory:';

/** Message the preview iframe posts when a memory link is clicked. */
export const MEMORY_LINK_MESSAGE = 'dash:memory-link';

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
 * basename; relative `(x.md)` links resolve only to files that exist.
 */
export function rewriteMemoryLinks(markdown: string, entries: MemoryEntry[]): string {
  const byName = new Map(entries.map((e) => [e.name, e.file]));
  const files = new Set(entries.map((e) => e.file));
  const resolve = (ref: string): string | undefined =>
    byName.get(ref) ?? (files.has(`${ref}.md`) ? `${ref}.md` : undefined);

  return markdown
    .replace(/\[\[([^\]\n]+)\]\]/g, (_m, ref: string) => {
      const file = resolve(ref.trim());
      return file
        ? `[${ref}](${MEMORY_LINK_PREFIX}${encodeURIComponent(file)})`
        : `<span class="memory-missing">${escapeHtml(ref)}</span>`;
    })
    .replace(/\]\(([^)\s:/]+\.md)\)/g, (m, file: string) =>
      files.has(file) ? `](${MEMORY_LINK_PREFIX}${encodeURIComponent(file)})` : m,
    );
}

/**
 * Injected into the preview document's <head>. `<base target=_blank>` sends
 * ordinary links to the window-open handler (→ system browser); memory links
 * are intercepted and posted to the parent. The iframe has no same-origin, so
 * postMessage is the only way out.
 */
export const MEMORY_PREVIEW_HEAD = `<base target="_blank" />
<style>.memory-missing{opacity:.55;text-decoration:underline dotted}</style>
<script>
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest && e.target.closest('a[href^="${MEMORY_LINK_PREFIX}"]');
  if (!a) return;
  e.preventDefault();
  var file = decodeURIComponent(a.getAttribute('href').slice(${MEMORY_LINK_PREFIX.length}));
  parent.postMessage({ type: '${MEMORY_LINK_MESSAGE}', file: file }, '*');
});
</script>`;
