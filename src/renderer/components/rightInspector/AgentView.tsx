import { useEffect, useMemo, useState } from 'react';
import { Brain, Copy, FileText, FolderOpen, List } from 'lucide-react';
import { toast } from 'sonner';
import { MEMORY_INDEX_FILE } from '../../../shared/types';
import type { Task } from '../../../shared/types';
import type { TaskScratchpad } from '../../../shared/agent';
import { useEditors } from '../../stores/editorsStore';
import { useProjects } from '../../stores/projectsStore';
import { useUi } from '../../stores/uiStore';
import { FilesTopRow } from '../fileTree/FilesTopRow';
import { FileTree } from '../fileTree/FileTree';
import { buildTree, type TreeSection } from '../fileTree/model';
import { useProjectMemory } from '../memory/useProjectMemory';
import { MEMORY_TYPE_LABELS } from '../memory/memoryView';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { Segmented } from '../ui/Segmented';
import { instructionFiles, memoryGroups, type AgentPane } from './agentTab';

/** Open a file of one of Claude's own folders (no task's worktree): the
 *  editor opens over everything, as the memory modal's Edit does (A3). */
function openPlainFile(dir: string, filePath: string): void {
  useEditors.getState().open({ cwd: dir, filePath, initialView: { kind: 'working', ref: 'HEAD' } });
}

function copyPath(path: string): void {
  window.electronAPI.clipboardWriteText(path);
  toast('Copied path', { description: path.length > 80 ? undefined : path, duration: 1800 });
}

/**
 * The task sidebar's Agent tab (A1): what Claude Code keeps beside the code,
 * one pane at a time under a switch in Files' top row: the session's
 * scratchpad as a tree, or the project's memories by type with MEMORY.md and
 * the repo's CLAUDE.md files. Both follow the disk live.
 */
export function AgentView({
  task,
  pane,
  onPane,
  repoPaths,
  onOpenTaskFile,
}: {
  task: Task;
  pane: AgentPane;
  onPane: (pane: AgentPane) => void;
  /** The worktree's files, for its CLAUDE.md files. */
  repoPaths: readonly string[];
  /** Open a file of the task's worktree in its editor (expanding the sidebar). */
  onOpenTaskFile: (path: string) => void;
}) {
  const scratchpad = useTaskScratchpad(task.id);
  const project = useProjects((s) => s.projects.find((p) => p.id === task.projectId) ?? null);

  const end =
    pane === 'scratchpad'
      ? scratchpad?.exists && (
          <IconButton
            size="sm"
            title="Copy scratchpad path"
            onClick={() => copyPath(scratchpad.dir)}
          >
            <Copy size={14} strokeWidth={1.8} />
          </IconButton>
        )
      : project && (
          <IconButton
            size="sm"
            title="Open memory"
            onClick={() => useUi.getState().openTaskMemory(project.id, task.id)}
          >
            <Brain size={14} strokeWidth={1.8} />
          </IconButton>
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
        <ScratchpadPane scratchpad={scratchpad} />
      ) : (
        <MemoryPane
          projectPath={project?.path ?? null}
          repoPaths={repoPaths}
          onOpenTaskFile={onOpenTaskFile}
        />
      )}
    </div>
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

function ScratchpadPane({ scratchpad }: { scratchpad: TaskScratchpad | null | undefined }) {
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
  return (
    <FileTree
      sections={sections}
      cwd={scratchpad.dir}
      selected={null}
      onOpenFile={(row) => openPlainFile(scratchpad.dir, row.file.path)}
      canOpenToSide={false}
      gapAbove
    />
  );
}

function MemoryPane({
  projectPath,
  repoPaths,
  onOpenTaskFile,
}: {
  projectPath: string | null;
  repoPaths: readonly string[];
  onOpenTaskFile: (path: string) => void;
}) {
  const { memory, error } = useProjectMemory(projectPath ?? '', projectPath === null);
  const groups = useMemo(() => memoryGroups(memory?.entries ?? []), [memory]);
  const instructions = useMemo(() => instructionFiles(repoPaths), [repoPaths]);
  if (error)
    return <EmptyState illustration={Brain} title="Could not read memory" description={error} />;
  if (!memory) return null;

  const noMemory = groups.length === 0 && !memory.hasIndex;
  return (
    <div className="scrollbar-thin-hover min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-2">
      {noMemory ? (
        <EmptyState
          illustration={Brain}
          title="No memories yet"
          description="Claude writes memories here as it learns about the project."
          className="flex-none"
        />
      ) : (
        <>
          {memory.hasIndex && (
            <ListRow
              size="sm"
              leading={<List size={14} strokeWidth={1.8} />}
              description="Index, loaded at session start"
              onClick={() => openPlainFile(memory.dir, MEMORY_INDEX_FILE)}
            >
              {MEMORY_INDEX_FILE}
            </ListRow>
          )}
          {groups.map((group) => (
            <section key={group.type}>
              <GroupHeading label={MEMORY_TYPE_LABELS[group.type]} count={group.entries.length} />
              {group.entries.map((entry) => (
                <ListRow
                  key={entry.file}
                  size="sm"
                  description={entry.description || undefined}
                  title={entry.file}
                  onClick={() => openPlainFile(memory.dir, entry.file)}
                >
                  {entry.name}
                </ListRow>
              ))}
            </section>
          ))}
        </>
      )}
      {instructions.length > 0 && (
        <section>
          <GroupHeading label="Instructions" count={instructions.length} />
          {instructions.map((path) => (
            <ListRow
              key={path}
              size="sm"
              leading={<FileText size={14} strokeWidth={1.8} />}
              onClick={() => onOpenTaskFile(path)}
            >
              {path}
            </ListRow>
          ))}
        </section>
      )}
    </div>
  );
}

/** A group's title ("Feedback · 4"), as the file tree's sections are headed. */
function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="type-subheading px-2.5 pt-3 pb-1">
      {label} · <span className="tabular-nums">{count}</span>
    </div>
  );
}
