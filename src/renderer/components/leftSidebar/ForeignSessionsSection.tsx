import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plug,
  Square,
  Trash2,
  Import,
} from 'lucide-react';
import type { Project, SupervisorSession } from '../../../shared/types';
import { useRuntime } from '../../stores/runtimeStore';
import { useProjects } from '../../stores/projectsStore';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { SessionAttachModal } from '../session/SessionAttachModal';
import { foreignSessionsFor, taskOwnership } from './foreignSessions';

interface ForeignSessionsSectionProps {
  project: Project;
  onSelectTask: (projectId: string, taskId: string) => void;
}

function stateDot(s: SupervisorSession): { className: string; label: string } {
  if (s.state === 'failed') return { className: 'status-dot-err', label: 'Failed' };
  if (s.state === 'stopped' || s.pid === undefined) {
    return { className: 'status-dot-stopped', label: 'Sleeping' };
  }
  if (s.status === 'busy') return { className: 'bg-amber-400 status-pulse', label: 'Working' };
  if (s.status === 'waiting') {
    return { className: 'status-dot-wait', label: s.waitingFor ?? 'Waiting' };
  }
  return { className: 'status-dot-idle', label: 'Idle' };
}

/**
 * Collapsed "Other sessions" group under a project: sessions Claude Code's
 * supervisor lists inside the project (including its worktrees) that no Dash
 * task owns — started from a plain `claude` or `claude --bg`, or left behind
 * by a deleted task. Background sessions can be attached, stopped, removed or
 * adopted as a task; interactive ones (no job id) show state only.
 */
export function ForeignSessionsSection({ project, onSelectTask }: ForeignSessionsSectionProps) {
  const [open, setOpen] = useState(false);
  const [attachRow, setAttachRow] = useState<SupervisorSession | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const sessions = useRuntime((s) => s.supervisorSessions);
  const stopSession = useRuntime((s) => s.stopSession);
  const removeSession = useRuntime((s) => s.removeSession);
  const adoptSession = useRuntime((s) => s.adoptSession);
  // Derive from the stable map reference (a selector returning fresh Sets
  // would re-render forever — see the useShallow caveat in CLAUDE.md).
  const tasksByProject = useProjects((s) => s.tasksByProject);
  const owned = useMemo(() => taskOwnership(tasksByProject), [tasksByProject]);

  const rows = foreignSessionsFor(project, sessions, owned);
  if (rows.length === 0) return null;

  const run = async (jobId: string, fn: () => Promise<unknown>) => {
    setBusyId(jobId);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full pl-3.5 pr-2 py-[5px] rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={2} />
        ) : (
          <ChevronRight size={12} strokeWidth={2} />
        )}
        <span>Other sessions ({rows.length})</span>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-px">
            {rows.map((row) => {
              const dot = stateDot(row);
              const key = row.id ?? row.sessionId ?? `${row.cwd}:${row.startedAt}`;
              const label = row.name || row.cwd.split('/').filter(Boolean).pop() || 'session';
              const isBusy = busyId === row.id;
              return (
                <div
                  key={key}
                  className="group/foreign grid grid-cols-[14px_minmax(0,1fr)] -ml-2 pl-2 pr-2 py-[3px] rounded-md text-base text-muted-fade-70 sidebar-row-hover"
                >
                  <div className="row-start-1 col-start-1 self-center pt-[3px]">
                    <Tooltip content={dot.label}>
                      <div className={`${dot.className} w-[6px] h-[6px] rounded-full`} />
                    </Tooltip>
                  </div>
                  <div className="row-start-1 col-start-2 flex items-center gap-2 min-w-0">
                    <Tooltip content={row.cwd}>
                      <span className="truncate flex-1 min-w-0">{label}</span>
                    </Tooltip>
                    <span className="text-xs text-muted-fade-50 shrink-0 group-hover/foreign:hidden">
                      {row.id ? row.id : 'interactive'}
                      {row.startedAt
                        ? ` · ${formatRelativeTime(Math.floor(row.startedAt / 1000), Math.floor(Date.now() / 1000))}`
                        : ''}
                    </span>
                    {row.id && (
                      <div className="hidden group-hover/foreign:flex items-center gap-0.5 shrink-0">
                        <IconButton
                          size="sm"
                          title="Attach"
                          onClick={() => {
                            if (!isBusy) setAttachRow(row);
                          }}
                        >
                          <Plug size={12} strokeWidth={1.8} />
                        </IconButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="rounded-md p-0.5 transition-colors duration-150 hover:bg-accent text-fg-fade-80 hover:text-foreground disabled:opacity-40"
                              aria-label="Session actions"
                              disabled={isBusy}
                            >
                              <MoreHorizontal size={12} strokeWidth={1.8} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(row.id!, async () => {
                                  const task = await adoptSession(project.id, row.id!);
                                  if (task) onSelectTask(project.id, task.id);
                                })
                              }
                            >
                              <Import size={12} strokeWidth={1.8} />
                              Adopt as task
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void run(row.id!, () => stopSession(row.id!))}
                            >
                              <Square size={12} strokeWidth={1.8} />
                              Stop
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void run(row.id!, () => removeSession(row.id!))}
                            >
                              <Trash2 size={12} strokeWidth={1.8} />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {attachRow?.id && (
        <SessionAttachModal
          session={{ ...attachRow, id: attachRow.id }}
          onClose={() => setAttachRow(null)}
        />
      )}
    </>
  );
}
