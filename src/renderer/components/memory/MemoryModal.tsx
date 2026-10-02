import { useCallback, useMemo, useState } from 'react';
import {
  Brain,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  List,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MEMORY_INDEX_FILE } from '../../../shared/types';
import type { IpcResponse, MemoryEntry, MemoryType, Project } from '../../../shared/types';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { Modal, useModalClose, useModalCloseGuard } from '../ui/Modal';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { useProjects } from '../../stores/projectsStore';
import { useUi } from '../../stores/uiStore';
import { openInIde } from '../../lib/openInIde';
import { CascadeConfirm } from '../extensions/CascadeConfirm';
import { MemoryEditor } from './MemoryEditor';
import { MemoryPreview } from './MemoryPreview';
import { useMemoryDraft } from './useMemoryDraft';
import { useProjectMemory } from './useProjectMemory';
import {
  memoryCounts,
  memoryDocs,
  memoryNotices,
  memoryReferrers,
  memorySections,
  pickCurrent,
  COLLAPSED_SECTIONS,
  KNOWN_MEMORY_TYPES,
  MEMORY_ISSUE_LABELS,
  MEMORY_SECTION_LABELS,
  MEMORY_TYPE_LABELS,
  type MemoryFilter,
  type MemorySectionId,
} from './memoryView';

interface Props {
  project: Project;
  isDark: boolean;
  onClose: () => void;
}

export function MemoryModal({ project, isDark, onClose }: Props) {
  return (
    <Modal onClose={onClose} size="w-[1040px] max-w-[94vw] h-[86vh] max-h-[760px]">
      {/* Keyed so switching project resets the selection and search. */}
      <MemoryBody key={project.id} project={project} isDark={isDark} />
    </Modal>
  );
}

function copy(text: string): void {
  window.electronAPI.clipboardWriteText(text);
  toast('Copied path', { description: text.length > 80 ? undefined : text, duration: 1800 });
}

/** Surface a failed or rejected action instead of dropping it. Resolves true when it worked. */
async function reportFailure(
  action: Promise<IpcResponse<null> | void>,
  fallback: string,
): Promise<boolean> {
  try {
    const res = await action;
    if (!res || res.success) return true;
    toast.error(res.error || fallback);
  } catch (err) {
    console.error(fallback, err);
    toast.error(fallback);
  }
  return false;
}

function deleteMessage(entry: MemoryEntry, referrers: MemoryEntry[]): string {
  const base = `Delete “${entry.name}”? ${entry.file} is moved to the trash and its line is removed from ${MEMORY_INDEX_FILE}, so Claude stops recalling it.`;
  if (referrers.length === 0) return base;
  const names = referrers.map((r) => `“${r.name}”`).join(', ');
  const plural = referrers.length === 1 ? 'memory still links' : 'memories still link';
  return `${base} ${referrers.length} other ${plural} to it and will be left pointing at nothing: ${names}.`;
}

function MemoryBody({ project, isDark }: { project: Project; isDark: boolean }) {
  const projects = useProjects((s) => s.projects);
  const switchProject = useUi((s) => s.setMemoryProjectId);
  const handleClose = useModalClose();
  const { memory, error, reload } = useProjectMemory(project.path);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MemoryEntry | null>(null);
  const [filter, setFilter] = useState<MemoryFilter>('all');
  // Sections the user opened or closed by hand; the rest keep their default.
  const [toggled, setToggled] = useState<Partial<Record<MemorySectionId, boolean>>>({});
  // "Recent" is measured from when the modal opened, so rows don't move while it is up.
  const [openedAt] = useState(() => Date.now());
  // A memory shown from outside the list (a save, a followed link) brings its type's tab along.
  const showType = useCallback((type: MemoryType) => {
    setFilter((f) => (f === 'all' || f === type ? f : type === 'other' ? 'all' : type));
  }, []);
  const onSaved = useCallback(
    (file: string, type: MemoryType) => {
      setSelected(file);
      showType(type);
    },
    [showType],
  );
  const editor = useMemoryDraft({ projectPath: project.path, reload, onSaved });
  // Esc, the backdrop and the X all ask before dropping unsaved edits.
  useModalCloseGuard(editor.discard);

  const entries = useMemo(() => memory?.entries ?? [], [memory]);
  const sections = useMemo(
    () => memorySections(entries, filter, query, openedAt),
    [entries, filter, query, openedAt],
  );
  const counts = useMemo(() => memoryCounts(entries, query), [entries, query]);
  const docs = useMemo(() => (memory ? memoryDocs(memory) : []), [memory]);
  // Search filters the list only; the preview changes on click, never on typing.
  const current = pickCurrent(docs, selected);
  const currentEntry = current?.entry;
  // A new memory has no row yet; an edit keeps its own row lit.
  const creating = editor.draft?.target === null;

  const openMemory = useCallback(
    (file: string) => {
      setSelected(file);
      const type = entries.find((e) => e.file === file)?.type;
      if (type) showType(type);
    },
    [entries, showType],
  );
  const select = (file: string) => {
    if (editor.discard()) setSelected(file);
  };
  const startNew = () => editor.startNew(filter === 'all' ? undefined : filter);
  const confirmDelete = async (entry: MemoryEntry) => {
    setDeleting(null);
    const deleted = await reportFailure(
      window.electronAPI.memoryDelete({ projectPath: project.path, file: entry.file }),
      'Could not delete the memory',
    );
    if (deleted) toast(`Moved ${entry.file} to the trash`, { duration: 1800 });
    await reload();
  };
  const prune = async () => {
    try {
      const res = await window.electronAPI.memoryPrune({ projectPath: project.path });
      if (!res.success || !res.data) throw new Error(res.error);
      const kept = (memory?.dangling.length ?? 0) - res.data.removed.length;
      // A line that also links something else isn't dropped for one dead link.
      if (kept > 0) {
        toast(`${kept} ${kept === 1 ? 'link shares' : 'links share'} a line with another`, {
          description: `Edit ${MEMORY_INDEX_FILE} by hand to remove ${kept === 1 ? 'it' : 'them'}.`,
        });
      }
    } catch (err) {
      console.error('Could not tidy the memory index', err);
      toast.error(`Could not tidy ${MEMORY_INDEX_FILE}`);
    }
    await reload();
  };
  const now = Date.now() / 1000;
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border/40 px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="text-[14px] font-semibold tracking-tight text-foreground">Memory</h2>
          <Select
            value={project.id}
            onValueChange={(id) => {
              if (editor.discard()) switchProject(id);
            }}
            options={projectOptions}
            className="w-auto max-w-[260px] px-2 py-1"
          />
        </div>
        <div className="flex items-center gap-1">
          {memory?.index != null && (
            <IconButton
              onClick={() => select(MEMORY_INDEX_FILE)}
              title={`View index (${MEMORY_INDEX_FILE})`}
              className={
                !editor.draft && current?.key === MEMORY_INDEX_FILE
                  ? 'bg-accent text-foreground'
                  : ''
              }
            >
              <List size={14} strokeWidth={1.8} />
            </IconButton>
          )}
          {memory && (
            <IconButton onClick={startNew} title="New memory">
              <Plus size={14} strokeWidth={1.8} />
            </IconButton>
          )}
          {memory?.exists && (
            <>
              <IconButton
                onClick={() =>
                  void reportFailure(openInIde(memory.dir), 'Could not open the memory folder')
                }
                title="Open folder in editor"
              >
                <ExternalLink size={14} strokeWidth={1.8} />
              </IconButton>
              <IconButton
                onClick={() =>
                  void reportFailure(
                    window.electronAPI.memoryOpenDir({ projectPath: project.path }),
                    'Could not reveal the memory folder',
                  )
                }
                title="Reveal folder"
              >
                <FolderOpen size={14} strokeWidth={1.8} />
              </IconButton>
            </>
          )}
          {memory && (
            <IconButton onClick={() => copy(memory.dir)} title="Copy folder path">
              <Copy size={14} strokeWidth={1.8} />
            </IconButton>
          )}
          <IconButton onClick={handleClose} title="Close">
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-border/40 bg-destructive/10 px-5 py-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {memory &&
        memoryNotices(memory).map((notice) => (
          <div
            key={notice.text}
            className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-surface-2 px-5 py-2 text-[11px] text-muted-foreground"
          >
            <span className="min-w-0">{notice.text}</span>
            {notice.action === 'prune' && (
              <Button variant="secondary" size="sm" onClick={() => void prune()}>
                Remove {memory.dangling.length === 1 ? 'its line' : 'their lines'}
              </Button>
            )}
          </div>
        ))}

      {/* A missing folder and an empty one (Claude creates it before writing) look the same. */}
      {memory && docs.length === 0 && !editor.draft ? (
        <EmptyState dir={memory.dir} projectName={project.name} onCreate={startNew} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border/40 px-5 py-2">
            <div className="w-[600px] max-w-full">
              <Segmented
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All', count: counts.all || undefined },
                  ...KNOWN_MEMORY_TYPES.map((t) => ({
                    value: t,
                    label: MEMORY_TYPE_LABELS[t],
                    count: counts[t] || undefined,
                  })),
                ]}
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="flex w-[300px] shrink-0 flex-col border-r border-border/40">
              <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
                <Search size={14} strokeWidth={1.8} className="text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search memories"
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-hidden placeholder:text-muted-foreground"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-1">
                {sections.map((section) => {
                  const hasCurrent =
                    !creating && section.entries.some((m) => m.entry.file === current?.key);
                  // A search shows every match; otherwise a closed section still opens for the shown memory.
                  const open =
                    query.trim() !== '' ||
                    (toggled[section.id] ?? (!COLLAPSED_SECTIONS.has(section.id) || hasCurrent));
                  return (
                    <div key={section.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setToggled((t) => ({ ...t, [section.id]: !open }))}
                        className="sticky top-0 z-10 flex w-full items-center gap-1 bg-[hsl(var(--surface-1)/0.92)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground"
                      >
                        <ChevronRight
                          size={12}
                          strokeWidth={2}
                          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                        />
                        {MEMORY_SECTION_LABELS[section.id]} · {section.entries.length}
                      </button>
                      {open &&
                        section.entries.map(({ entry: e, issues }) => (
                          <ListRow
                            key={e.file}
                            active={!creating && current?.key === e.file}
                            title={e.name}
                            subtitle={e.description}
                            meta={formatRelativeTime(e.mtimeMs / 1000, now)}
                            flag={[
                              // Mixed types only sit together under "all".
                              ...(filter === 'all' &&
                              section.id === 'attention' &&
                              e.type !== 'other'
                                ? [MEMORY_TYPE_LABELS[e.type].toLowerCase()]
                                : []),
                              ...issues.map((i) => MEMORY_ISSUE_LABELS[i]),
                            ].join(' · ')}
                            onClick={() => select(e.file)}
                          />
                        ))}
                    </div>
                  );
                })}
                {memory && sections.length === 0 && (
                  <div className="px-3 py-4 text-[12px] text-muted-foreground">
                    {query.trim()
                      ? 'No matches'
                      : filter === 'all'
                        ? 'No memories yet'
                        : `No ${MEMORY_TYPE_LABELS[filter].toLowerCase()} memories yet`}
                  </div>
                )}
              </div>
            </div>

            {editor.draft ? (
              <MemoryEditor draft={editor.draft} api={editor} entries={entries} isDark={isDark} />
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
                {current && memory && (
                  <>
                    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/40 px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-foreground">
                            {current.title}
                          </span>
                          {current.type && (
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {MEMORY_TYPE_LABELS[current.type]}
                            </span>
                          )}
                        </div>
                        {current.description && (
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            {current.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {currentEntry && (
                          <>
                            <IconButton onClick={() => editor.startEdit(currentEntry)} title="Edit">
                              <Pencil size={14} strokeWidth={1.8} />
                            </IconButton>
                            <IconButton
                              onClick={() => setDeleting(currentEntry)}
                              title="Delete"
                              variant="destructive"
                            >
                              <Trash2 size={14} strokeWidth={1.8} />
                            </IconButton>
                          </>
                        )}
                        <IconButton
                          onClick={() =>
                            void reportFailure(
                              window.electronAPI.openInEditor({
                                cwd: memory.dir,
                                filePath: current.file,
                              }),
                              'Could not open the memory in your editor',
                            )
                          }
                          title="Open in editor"
                        >
                          <ExternalLink size={14} strokeWidth={1.8} />
                        </IconButton>
                        <IconButton
                          onClick={() => copy(`${memory.dir}/${current.file}`)}
                          title="Copy path"
                        >
                          <Copy size={14} strokeWidth={1.8} />
                        </IconButton>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1">
                      <MemoryPreview
                        markdown={current.markdown}
                        entries={entries}
                        isDark={isDark}
                        onOpenMemory={openMemory}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {deleting && (
        <CascadeConfirm
          message={deleteMessage(deleting, memoryReferrers(entries, deleting))}
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function ListRow(props: {
  active: boolean;
  title: string;
  subtitle?: string;
  meta?: string;
  flag?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`block w-full px-3 py-1.5 text-left transition-colors ${
        props.active ? 'bg-accent' : 'hover:bg-accent/60'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{props.title}</span>
        {props.flag && <span className="shrink-0 text-[10px] text-fg-fade-40">{props.flag}</span>}
        {props.meta && <span className="shrink-0 text-[10px] text-fg-fade-40">{props.meta}</span>}
      </div>
      {props.subtitle && (
        <div className="truncate text-[11px] text-muted-foreground">{props.subtitle}</div>
      )}
    </button>
  );
}

function EmptyState(props: { dir: string; projectName: string; onCreate: () => void }) {
  const { dir, projectName, onCreate } = props;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <Brain size={28} strokeWidth={1.5} className="text-muted-foreground" />
      <p className="text-[13px] text-foreground">No memories yet for {projectName}</p>
      <button
        onClick={() => copy(dir)}
        title="Copy path"
        className="max-w-full truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        {dir}
      </button>
      <p className="max-w-md text-[12px] text-muted-foreground">
        Claude writes memories here as it learns about the project.
      </p>
      <Button variant="secondary" size="sm" onClick={onCreate}>
        <Plus size={13} strokeWidth={1.8} /> New memory
      </Button>
    </div>
  );
}
