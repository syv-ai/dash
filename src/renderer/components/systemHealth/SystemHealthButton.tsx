import { useEffect, useMemo, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import type { SystemHealthSnapshot } from '@shared/systemHealth';
import type { Task } from '@shared/types';
import { cn } from '../../lib/cn';
import {
  formatMemory,
  healthSummary,
  idleTaskIds,
  PRESSURE_LABEL,
  sleepIdleLabel,
  usageOfThreshold,
} from '../../lib/memoryWarning';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import { sleepIdleTasks, useSystemHealthStore } from '../../stores/systemHealthStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { ListRow } from '../ui/ListRow';
import { Meter } from '../ui/Meter';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';

/** The heaviest tasks the popover lists. */
const TOP_TASKS = 5;

/**
 * The sidebar's health icon (Settings → System health), beside Settings, or
 * above it on the rail: the neutral icon while healthy, `warn` amber past the
 * threshold or under macOS's warn pressure, and breathing too under critical
 * pressure (`healthLevel`, the memory warning's own verdict). It opens a
 * popover with Dash's total against the threshold, the OS's pressure, the
 * heaviest tasks (each selects its task) and the warning's "Sleep N idle
 * tasks"; main samples faster while it is open, so the numbers move.
 */
export function SystemHealthButton({
  rail = false,
  onSelectTask,
}: {
  /** On the collapsed sidebar's rail: the popover opens beside it. */
  rail?: boolean;
  onSelectTask: (projectId: string, taskId: string) => void;
}) {
  const on = useSettings((s) => s.systemHealthIcon);
  const snapshot = useSystemHealthStore((s) => s.snapshot);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.systemHealthSetLive(true);
    return () => window.electronAPI.systemHealthSetLive(false);
  }, [open]);

  if (!on) return null;
  const level = snapshot?.level ?? 'ok';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          title="System health"
          description={healthSummary(snapshot)}
          data-level={level}
          variant={level === 'ok' ? 'default' : 'warn'}
        >
          <HeartPulse
            size={14}
            strokeWidth={1.8}
            className={cn(level === 'critical' && 'motion-safe:animate-breathe')}
          />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side={rail ? 'right' : 'top'} align={rail ? 'end' : 'start'} className="w-80">
        <HealthPanel
          snapshot={snapshot}
          onSelectTask={(projectId, taskId) => {
            setOpen(false);
            onSelectTask(projectId, taskId);
          }}
          onSlept={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function HealthPanel({
  snapshot,
  onSelectTask,
  onSlept,
}: {
  snapshot: SystemHealthSnapshot | null;
  onSelectTask: (projectId: string, taskId: string) => void;
  onSlept: () => void;
}) {
  const activity = useRuntime((s) => s.taskActivity);
  const activeTaskId = useProjects((s) => s.activeTaskId);
  const tasksByProject = useProjects((s) => s.tasksByProject);
  const idleCount = useMemo(
    () => idleTaskIds(activity, activeTaskId).length,
    [activity, activeTaskId],
  );
  const taskById = useMemo(() => {
    const m = new Map<string, Task>();
    for (const list of Object.values(tasksByProject)) for (const t of list) m.set(t.id, t);
    return m;
  }, [tasksByProject]);
  const sleepLabel = sleepIdleLabel(idleCount);

  return (
    <div className="grid gap-3 p-3.5">
      <h4 className="type-heading">System health</h4>
      {snapshot ? (
        <>
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="type-label">Dash and its sessions</span>
              <span
                className={cn(
                  'text-sm tabular-nums',
                  snapshot.totalBytes >= snapshot.thresholdBytes ? 'text-warn' : 'text-ink',
                )}
              >
                {usageOfThreshold(snapshot)}
              </span>
            </div>
            <Meter
              value={(snapshot.totalBytes / snapshot.thresholdBytes) * 100}
              tone={snapshot.totalBytes >= snapshot.thresholdBytes ? 'warn' : 'neutral'}
              aria-label="Memory against your warning threshold"
            />
          </div>
          {snapshot.pressure && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="type-label">Memory pressure (macOS)</span>
              <span
                className={cn('text-sm', snapshot.pressure === 'normal' ? 'text-ink' : 'text-warn')}
              >
                {PRESSURE_LABEL[snapshot.pressure]}
              </span>
            </div>
          )}
          <div className="grid gap-1">
            <h5 className="type-subheading">Heaviest tasks</h5>
            {snapshot.tasks.length === 0 ? (
              <p className="type-caption">No task sessions are running.</p>
            ) : (
              <div className="-mx-2.5 grid">
                {snapshot.tasks.slice(0, TOP_TASKS).map((t) => {
                  const task = taskById.get(t.taskId);
                  return (
                    <ListRow
                      key={t.taskId}
                      size="xs"
                      disabled={!task}
                      onClick={() => task && onSelectTask(task.projectId, task.id)}
                      trailing={<span className="tabular-nums">{formatMemory(t.bytes)}</span>}
                    >
                      {task?.name ?? t.name}
                    </ListRow>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="type-caption">Measuring…</p>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={!sleepLabel}
        onClick={() => {
          sleepIdleTasks();
          onSlept();
        }}
      >
        {sleepLabel ?? 'No idle tasks to sleep'}
      </Button>
    </div>
  );
}
