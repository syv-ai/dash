import { useMemo, useState } from 'react';
import { MoreHorizontal, Plug, Square, Trash2, Import } from 'lucide-react';
import type { Project, SupervisorSession } from '../../../shared/types';
import { useRuntime } from '../../stores/runtimeStore';
import { useProjects } from '../../stores/projectsStore';
import { formatRelativeTime } from '../../../shared/relativeTime';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { StatusDot, type AgentState } from '../ui/StatusDot';
import { Tooltip } from '../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { SessionAttachModal } from '../session/SessionAttachModal';
import { foreignSessionsFor, taskOwnership } from './foreignSessions';
import { Disclosure } from './Disclosure';

interface ForeignSessionsSectionProps {
  project: Project;
  onSelectTask: (projectId: string, taskId: string) => void;
}

/** A session's state as a task dot; sleeping and idle sessions get none. */
function sessionDot(s: SupervisorSession): { state: AgentState; label: string } | null {
  if (s.state === 'failed') return { state: 'fail', label: 'Failed' };
  if (s.state === 'stopped' || s.pid === undefined) return null;
  if (s.status === 'busy') return { state: 'work', label: 'Working' };
  if (s.status === 'waiting') return { state: 'needs', label: s.waitingFor ?? 'Waiting' };
  return null;
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
      <Disclosure
        label={`Other sessions (${rows.length})`}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      >
        {rows.map((row) => {
          const dot = sessionDot(row);
          const key = row.id ?? row.sessionId ?? `${row.cwd}:${row.startedAt}`;
          const label = row.name || row.cwd.split('/').filter(Boolean).pop() || 'session';
          const isBusy = busyId === row.id;
          const meta = `${row.id ? row.id : 'interactive'}${
            row.startedAt
              ? ` · ${formatRelativeTime(Math.floor(row.startedAt / 1000), Math.floor(Date.now() / 1000))}`
              : ''
          }`;
          return (
            <div key={key} className="group/foreign">
              <ListRow
                as="div"
                size="sm"
                dimmed
                leading={
                  dot ? (
                    <StatusDot state={dot.state} label={dot.label} />
                  ) : (
                    <span className="size-1.5" />
                  )
                }
                trailing={
                  <>
                    <span className="text-xs group-hover/foreign:hidden">{meta}</span>
                    {row.id && (
                      <span className="hidden items-center gap-0.5 group-hover/foreign:flex">
                        <IconButton
                          size="sm"
                          title="Attach"
                          disabled={isBusy}
                          onClick={() => setAttachRow(row)}
                        >
                          <Plug size={13} strokeWidth={1.8} />
                        </IconButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild disabled={isBusy}>
                            <IconButton size="sm" title="Session actions" disabled={isBusy}>
                              <MoreHorizontal size={13} strokeWidth={1.8} />
                            </IconButton>
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
                              <Import size={13} strokeWidth={1.8} />
                              Adopt as task
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void run(row.id!, () => stopSession(row.id!))}
                            >
                              <Square size={13} strokeWidth={1.8} />
                              Stop
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => void run(row.id!, () => removeSession(row.id!))}
                            >
                              <Trash2 size={13} strokeWidth={1.8} />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                    )}
                  </>
                }
              >
                <Tooltip content={row.cwd}>
                  <span>{label}</span>
                </Tooltip>
              </ListRow>
            </div>
          );
        })}
      </Disclosure>

      {attachRow?.id && (
        <SessionAttachModal
          session={{ ...attachRow, id: attachRow.id }}
          onClose={() => setAttachRow(null)}
        />
      )}
    </>
  );
}
