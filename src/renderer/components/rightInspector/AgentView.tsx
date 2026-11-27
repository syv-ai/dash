import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AtSign,
  Brain,
  Copy,
  FileText,
  FolderOpen,
  Link2,
  List,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from '../ui/toast';
import { MEMORY_INDEX_FILE } from '../../../shared/types';
import type { MemoryEntry, Task } from '../../../shared/types';
import type { TaskScratchpad } from '../../../shared/agent';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { typeIntoTask } from '../../utils/typeIntoTask';
import { FilesTopRow } from '../fileTree/FilesTopRow';
import { FileTree } from '../fileTree/FileTree';
import { buildTree, type TreeSection } from '../fileTree/model';
import { copyText, revealLabel } from '../diffEditor/fileActions';
import { useProjectMemory } from '../memory/useProjectMemory';
import {
  MEMORY_ISSUE_LABELS,
  MEMORY_TYPE_LABELS,
  listMemories,
  memoryIssueTexts,
  memoryMatches,
  memoryMention,
  memoryNotices,
} from '../memory/memoryView';
import { confirm } from '../ui/ConfirmHost';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
} from '../ui/ContextMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { DetailSection } from '../ui/DetailList';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { ListRow } from '../ui/ListRow';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { useSectionOpen } from '../review/useSectionOpen';
import { instructionFiles, memoryGroups, type AgentPane } from './agentTab';

/**
 * The task sidebar's Agent tab (A1): what Claude Code keeps beside the code,
 * one pane at a time under a switch in Files' top row: the session's
 * scratchpad as a tree, or the project's memories by type with MEMORY.md and
 * the repo's CLAUDE.md files. Both follow the disk live. Every file opens in
 * the task's own editor, expanding the sidebar (A10): a scratchpad or memory
 * file by its absolute path, a CLAUDE.md by its worktree one.
 */
export function AgentView({
  task,
  pane,
  onPane,
  repoPaths,
  activePath,
  onOpenFile,
}: {
  task: Task;
  pane: AgentPane;
  onPane: (pane: AgentPane) => void;
  /** The worktree's files, for its CLAUDE.md files. */
  repoPaths: readonly string[];
  /** The file the task's editor shows, to mark its row. */
  activePath: string | null;
  /** Open a file in the task's editor (expanding the sidebar): worktree-relative or absolute. */
  onOpenFile: (path: string) => void;
}) {
  const scratchpad = useTaskScratchpad(task.id);
  const project = useProjects((s) => s.projects.find((p) => p.id === task.projectId) ?? null);
  const { memory, error } = useProjectMemory(pane === 'memory' ? (project?.path ?? null) : null);

  const end =
    pane === 'scratchpad'
      ? scratchpad?.exists && (
          <IconButton
            size="sm"
            title="Copy scratchpad path"
            onClick={() => copyText(scratchpad.dir, 'path')}
          >
            <Copy size={14} strokeWidth={1.8} />
          </IconButton>
        )
      : project &&
        memory && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" title="More">
                <MoreHorizontal size={14} strokeWidth={1.8} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!memory.exists}
                onSelect={() => void revealMemoryFolder(project.path)}
              >
                <FolderOpen size={14} strokeWidth={1.8} />
                {revealLabel()}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copyText(memory.dir, 'path')}>
                <Copy size={14} strokeWidth={1.8} />
                Copy folder path
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <FilesTopRow
        start={
          <Segmented<AgentPane>
            aria-label="Scratchpad or memory"
            size="sm"
            fullWidth={false}
            value={pane}
            onChange={onPane}
            options={[
              { value: 'scratchpad', label: 'Scratchpad' },
              { value: 'memory', label: 'Memory' },
            ]}
          />
        }
        end={end || undefined}
      />
      {pane === 'scratchpad' ? (
        <ScratchpadPane scratchpad={scratchpad} activePath={activePath} onOpenFile={onOpenFile} />
      ) : error ? (
        <EmptyState illustration={Brain} title="Could not read memory" description={error} />
      ) : (
        memory &&
        project && (
          <MemoryPane
            task={task}
            projectId={project.id}
            projectPath={project.path}
            dir={memory.dir}
            hasIndex={memory.hasIndex}
            entries={memory.entries}
            notices={memoryNotices(memory)}
            repoPaths={repoPaths}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        )
      )}
    </div>
  );
}

/** Surface a failed action instead of dropping it. */
async function attempt(
  action: Promise<{ success: boolean; error?: string }>,
  fallback: string,
): Promise<void> {
  try {
    const res = await action;
    if (!res.success) toast.error(res.error || fallback);
  } catch (err) {
    console.error(fallback, err);
    toast.error(fallback);
  }
}

function revealMemoryFolder(projectPath: string): Promise<void> {
  return attempt(
    window.electronAPI.memoryOpenDir({ projectPath }),
    'Could not reveal the memory folder',
  );
}

/**
 * The task's scratchpad, read again whenever main says it changed (its files,
 * or a new session's folder). Undefined while the first read is on its way;
 * null when the task has had no session.
 */
function useTaskScratchpad(taskId: string): TaskScratchpad | null | undefined {
  const [scratchpad, setScratchpad] = useState<TaskScratchpad | null | undefined>(undefined);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    void window.electronAPI.agentWatchScratchpad({ taskId });
    const off = window.electronAPI.onAgentScratchpadChanged((e) => {
      if (e.taskId === taskId) setReads((n) => n + 1);
    });
    return () => {
      off();
      void window.electronAPI.agentUnwatchScratchpad({ taskId });
    };
  }, [taskId]);
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.agentScratchpad({ taskId }).then((res) => {
      if (!cancelled) setScratchpad(res.success ? (res.data ?? null) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, reads]);
  return scratchpad;
}

function ScratchpadPane({
  scratchpad,
  activePath,
  onOpenFile,
}: {
  scratchpad: TaskScratchpad | null | undefined;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const sections = useMemo<TreeSection[]>(
    () =>
      scratchpad
        ? [
            {
              id: 'scratchpad',
              tree: buildTree([], {
                paths: scratchpad.listing.files,
                dirs: scratchpad.listing.dirs,
              }),
            },
          ]
        : [],
    [scratchpad],
  );
  if (scratchpad === undefined) return null;
  if (!scratchpad?.exists) {
    return (
      <EmptyState
        illustration={FolderOpen}
        title="No scratchpad yet"
        description="Claude Code gives each session a folder for its working files. It shows here once the session has one."
      />
    );
  }
  const { files, dirs } = scratchpad.listing;
  if (files.length === 0 && dirs.length === 0) {
    return (
      <EmptyState
        illustration={FolderOpen}
        title="The scratchpad is empty"
        description="Files Claude saves to its scratchpad show here."
      />
    );
  }
  const prefix = `${scratchpad.dir}/`;
  return (
    <FileTree
      sections={sections}
      cwd={scratchpad.dir}
      selected={activePath?.startsWith(prefix) ? { path: activePath.slice(prefix.length) } : null}
      onOpenFile={(row) => onOpenFile(`${prefix}${row.file.path}`)}
      canOpenToSide={false}
      gapAbove
    />
  );
}

function MemoryPane({
  task,
  projectId,
  projectPath,
  dir,
  hasIndex,
  entries,
  notices,
  repoPaths,
  activePath,
  onOpenFile,
}: {
  task: Task;
  projectId: string;
  projectPath: string;
  dir: string;
  hasIndex: boolean;
  entries: MemoryEntry[];
  notices: string[];
  repoPaths: readonly string[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const issues = useMemo(
    () => new Map(listMemories(entries).map((m) => [m.entry.file, m])),
    [entries],
  );
  const groups = useMemo(
    () => memoryGroups(entries.filter((e) => memoryMatches(e, query))),
    [entries, query],
  );
  const instructions = useMemo(() => instructionFiles(repoPaths), [repoPaths]);
  // Shown, the memories are seen: the project row's "new" badge clears, and
  // stays clear while the pane follows the folder.
  const markMemorySeen = useRuntime((s) => s.markMemorySeen);
  useEffect(() => {
    void markMemorySeen(projectId);
  }, [markMemorySeen, projectId, entries]);

  const pathOf = (file: string) => `${dir}/${file}`;
  const remove = async (entry: MemoryEntry) => {
    const ok = await confirm({
      message: hasIndex
        ? `Move "${entry.name}" to the Trash and drop its line from ${MEMORY_INDEX_FILE}?`
        : `Move "${entry.name}" to the Trash?`,
      confirmLabel: 'Move to Trash',
      destructive: true,
    });
    if (!ok) return;
    await attempt(
      window.electronAPI.memoryDelete({ projectPath, file: entry.file }),
      'Could not delete the memory',
    );
  };

  const noMemory = entries.length === 0 && !hasIndex;
  const now = Date.now() / 1000;
  return (
    <div className="scrollbar-thin-hover min-h-0 flex-1 overflow-y-auto pt-2 pb-2">
      <div className="px-1.5">
        {notices.map((notice) => (
          <Notice key={notice} className="mx-1 mb-2">
            {notice}
          </Notice>
        ))}
        {entries.length > 0 && (
          <div className="mx-1 mb-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
              placeholder="Search memories"
              aria-label="Search memories"
            />
          </div>
        )}
        {noMemory ? (
          <EmptyState
            illustration={Brain}
            title="No memories yet"
            description="Claude writes memories here as it learns about the project."
            className="flex-none"
          />
        ) : (
          hasIndex &&
          !query.trim() && (
            <ListRow
              size="sm"
              selected={activePath === pathOf(MEMORY_INDEX_FILE)}
              leading={<List size={14} strokeWidth={1.8} />}
              description="Index, loaded at session start"
              onClick={() => onOpenFile(pathOf(MEMORY_INDEX_FILE))}
            >
              {MEMORY_INDEX_FILE}
            </ListRow>
          )
        )}
      </div>
      {!noMemory && (
        <>
          {groups.map((group) => (
            <GroupSection
              key={group.type}
              id={`memory.${group.type}`}
              label={MEMORY_TYPE_LABELS[group.type]}
              count={group.entries.length}
            >
              {group.entries.map((entry) => {
                const listed = issues.get(entry.file);
                const flags = (listed?.issues ?? []).filter((i) => i !== 'untyped');
                return (
                  <ContextMenu key={entry.file}>
                    <ContextMenuTrigger asChild>
                      <ListRow
                        size="sm"
                        selected={activePath === pathOf(entry.file)}
                        description={entry.description || undefined}
                        title={[
                          `${entry.file} · edited ${formatRelativeTime(entry.mtimeMs / 1000, now)}`,
                          ...(listed ? memoryIssueTexts(listed) : []),
                        ].join('\n')}
                        trailing={
                          flags.length > 0
                            ? flags.map((i) => MEMORY_ISSUE_LABELS[i]).join(' · ')
                            : undefined
                        }
                        onClick={() => onOpenFile(pathOf(entry.file))}
                      >
                        {entry.name}
                      </ListRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItems
                        items={[
                          {
                            label: 'Open',
                            icon: FileText,
                            onSelect: () => onOpenFile(pathOf(entry.file)),
                          },
                          {
                            label: 'Mention in prompt',
                            icon: AtSign,
                            onSelect: () =>
                              void typeIntoTask(task.id, memoryMention(pathOf(entry.file))),
                          },
                          'separator',
                          {
                            label: 'Copy path',
                            icon: Link2,
                            onSelect: () => copyText(pathOf(entry.file), 'path'),
                          },
                          {
                            label: revealLabel(),
                            icon: FolderOpen,
                            onSelect: () => window.electronAPI.showItemInFolder(pathOf(entry.file)),
                          },
                          'separator',
                          {
                            label: 'Delete',
                            icon: Trash2,
                            destructive: true,
                            onSelect: () => void remove(entry),
                          },
                        ]}
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </GroupSection>
          ))}
          {query.trim() && groups.length === 0 && (
            <p className="type-caption px-4 py-3">No matches</p>
          )}
        </>
      )}
      {instructions.length > 0 && !query.trim() && (
        <GroupSection id="memory.instructions" label="Instructions" count={instructions.length}>
          {instructions.map((path) => (
            <ListRow
              key={path}
              size="sm"
              selected={activePath === path}
              leading={<FileText size={14} strokeWidth={1.8} />}
              onClick={() => onOpenFile(path)}
            >
              {path}
            </ListRow>
          ))}
        </GroupSection>
      )}
    </div>
  );
}

/** A group ("Feedback · 4") that folds away, as the PR overview's sections
 *  do; open until folded, and kept for the session under `id`. */
function GroupSection({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count: number;
  children: ReactNode;
}) {
  const section = useSectionOpen(id, true);
  return (
    <DetailSection title={label} summary={String(count)} collapsible {...section}>
      <div>{children}</div>
    </DetailSection>
  );
}
