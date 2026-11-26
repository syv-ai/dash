import { Modal, useModalClose } from '../ui/Modal';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/Command';
import { StatusDot } from '../ui/StatusDot';
import { useProjects } from '../../stores/projectsStore';
import { useTaskStateList } from './useTaskStateList';
import { STATE_LABELS, STATE_ORDER } from './taskStates';

interface TaskFinderProps {
  onSelectTask: (projectId: string, taskId: string) => void;
  onClose: () => void;
}

/** ⌘K: find a task by name or project, grouped by state like the sidebar. */
export function TaskFinder({ onSelectTask, onClose }: TaskFinderProps) {
  return (
    <Modal onClose={onClose} size="w-120">
      <TaskFinderList onSelectTask={onSelectTask} />
    </Modal>
  );
}

/** Substring match on the name and project only; the value is the task id,
 *  which a fuzzy match would otherwise hit. */
function matchKeywords(_value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLowerCase();
  return !needle || keywords?.some((k) => k.toLowerCase().includes(needle)) ? 1 : 0;
}

function TaskFinderList({ onSelectTask }: Pick<TaskFinderProps, 'onSelectTask'>) {
  const close = useModalClose();
  const { active, idle } = useTaskStateList();
  const projects = useProjects((s) => s.projects);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? '';
  const rows = [...active, ...idle];

  return (
    <Command loop filter={matchKeywords}>
      <CommandInput autoFocus placeholder="Find a task…" />
      <CommandList palette>
        <CommandEmpty>No matching task</CommandEmpty>
        {STATE_ORDER.map((state) => {
          const group = rows.filter((r) => r.state === state);
          if (group.length === 0) return null;
          return (
            <CommandGroup key={state} heading={STATE_LABELS[state]}>
              {group.map(({ task }) => (
                <CommandItem
                  key={task.id}
                  value={task.id}
                  keywords={[task.name, projectName(task.projectId)]}
                  onSelect={() => {
                    onSelectTask(task.projectId, task.id);
                    close();
                  }}
                >
                  <StatusDot state={state} />
                  <span className="min-w-0 flex-1 truncate">{task.name}</span>
                  <span className="shrink-0 text-xs text-ink-3">{projectName(task.projectId)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </Command>
  );
}
