import { useCallback, useMemo, useState } from 'react';
import { Brain, Copy, ExternalLink, FolderOpen, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { MEMORY_INDEX_FILE } from '../../../shared/types';
import type { IpcResponse, Project } from '../../../shared/types';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { Modal, useModalClose } from '../ui/Modal';
import { IconButton } from '../ui/IconButton';
import { Select } from '../ui/Select';
import { openInIde } from '../../lib/openInIde';
import { MemoryPreview } from './MemoryPreview';
import { useProjectMemory } from './useProjectMemory';
import { groupMemories, memoryDocs, pickCurrent, MEMORY_TYPE_LABELS } from './memoryView';

interface Props {
  project: Project;
  /** Every project, for the header switcher. */
  projects: Project[];
  onSwitchProject: (projectId: string) => void;
  isDark: boolean;
  onClose: () => void;
}

export function MemoryModal({ project, projects, onSwitchProject, isDark, onClose }: Props) {
  return (
    <Modal onClose={onClose} size="w-[1040px] max-w-[94vw] h-[86vh] max-h-[760px]">
      {/* Keyed so switching project resets the selection and search. */}
      <MemoryBody
        key={project.id}
        project={project}
        projects={projects}
        onSwitchProject={onSwitchProject}
        isDark={isDark}
      />
    </Modal>
  );
}

function copy(text: string): void {
  window.electronAPI.clipboardWriteText(text);
  toast('Copied path', { description: text.length > 80 ? undefined : text, duration: 1800 });
}

/** Surface a failed open/reveal instead of dropping it. */
async function reportFailure(action: Promise<IpcResponse<null>>, fallback: string): Promise<void> {
  const res = await action;
  if (!res.success) toast.error(res.error || fallback);
}

function MemoryBody({ project, projects, onSwitchProject, isDark }: Omit<Props, 'onClose'>) {
  const handleClose = useModalClose();
  const { memory, error } = useProjectMemory(project.path);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const entries = useMemo(() => memory?.entries ?? [], [memory]);
  const groups = useMemo(() => groupMemories(entries, query), [entries, query]);
  const docs = useMemo(() => (memory ? memoryDocs(memory) : []), [memory]);
  // Search filters the list only; the preview changes on click, never on typing.
  const current = pickCurrent(docs, selected);

  const openMemory = useCallback((file: string) => setSelected(file), []);
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
            onValueChange={onSwitchProject}
            options={projectOptions}
            className="w-auto max-w-[260px] px-2 py-1"
          />
        </div>
        <div className="flex items-center gap-1">
          {memory?.exists && (
            <>
              <IconButton onClick={() => void openInIde(memory.dir)} title="Open folder in editor">
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

      {memory && !memory.exists ? (
        <EmptyState dir={memory.dir} projectName={project.name} />
      ) : (
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
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {memory?.index != null && !query && (
                <ListRow
                  active={current?.key === MEMORY_INDEX_FILE}
                  title="Index"
                  subtitle={MEMORY_INDEX_FILE}
                  onClick={() => setSelected(MEMORY_INDEX_FILE)}
                />
              )}
              {groups.map((g) => (
                <div key={g.type} className="mt-2">
                  <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {MEMORY_TYPE_LABELS[g.type]} · {g.entries.length}
                  </div>
                  {g.entries.map((e) => (
                    <ListRow
                      key={e.file}
                      active={current?.key === e.file}
                      title={e.name}
                      subtitle={e.description}
                      meta={formatRelativeTime(e.mtimeMs / 1000, now)}
                      flag={e.inIndex ? undefined : 'not indexed'}
                      onClick={() => setSelected(e.file)}
                    />
                  ))}
                </div>
              ))}
              {memory && groups.length === 0 && query && (
                <div className="px-3 py-4 text-[12px] text-muted-foreground">No matches</div>
              )}
            </div>
          </div>

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
        </div>
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

function EmptyState({ dir, projectName }: { dir: string; projectName: string }) {
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
        Claude writes memories here as it learns about the project. If you set{' '}
        <code>autoMemoryDirectory</code> or turned off <code>autoMemoryEnabled</code> in your Claude
        settings, they live elsewhere or are off.
      </p>
    </div>
  );
}
