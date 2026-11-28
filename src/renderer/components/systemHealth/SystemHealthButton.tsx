import { useCallback, useEffect, useMemo, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import type { HealthPoint, SystemHealthSnapshot } from '@shared/systemHealth';
import type { Task } from '@shared/types';
import { AUTO_SLEEP_LABELS } from '../../lib/autoSleep';
import { cn } from '../../lib/cn';
import {
  formatAgo,
  formatDuration,
  formatMemory,
  headroomLabel,
  healthSummary,
  machineShare,
  PRESSURE_LABEL,
  sleepIdleLabel,
} from '../../lib/memoryWarning';
import { idleTaskIds } from '../../lib/idleTasks';
import { memoryColor } from '../../lib/usageColor';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import {
  loadHealthHistory,
  sleepIdleTasks,
  useSystemHealthStore,
} from '../../stores/systemHealthStore';
import { useUi } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { DetailItem, DetailList } from '../ui/DetailList';
import { Dot } from '../ui/Dot';
import { IconButton } from '../ui/IconButton';
import { InfoTip } from '../ui/InfoTip';
import { ListRow } from '../ui/ListRow';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { TextLink } from '../ui/TextLink';
import { TimelineChart, type TimelinePoint } from '../ui/TimelineChart';

/** The heaviest tasks the popover lists. */
const TOP_TASKS = 5;
/** The timeline spans at least this, so a fresh one grows in from the right
 *  rather than stretching three points across [provisional]. */
const MIN_SPAN_MS = 10 * 60_000;
/** Samples further apart than this (the hidden cadence's 5 min, missed twice,
 *  or sampling off) leave a gap in the line [provisional]. */
const GAP_MS = 12 * 60_000;

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
    void loadHealthHistory();
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
            className={cn(level === 'critical' && 'motion-safe:animate-breathe-few')}
          />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        side={rail ? 'right' : 'top'}
        align={rail ? 'end' : 'start'}
        surface="panel"
        className="w-92"
      >
        <HealthPanel
          snapshot={snapshot}
          onSelectTask={(projectId, taskId) => {
            setOpen(false);
            onSelectTask(projectId, taskId);
          }}
          onSlept={() => setOpen(false)}
          onOpenSettings={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The popover, top to bottom: the title, with a dot at the row's end that
 * breathes in the line's colour (`memoryColor`) while open; the figure and
 * its timeline as one instrument on a sunk well; the machine's facts as a
 * quiet key/value grid; the heaviest tasks; and the actions. Below the
 * figure everything reads at one size: keys, the tasks' heading and the
 * footer's line in `type-label`, values and tasks in ink.
 */
function HealthPanel({
  snapshot,
  onSelectTask,
  onSlept,
  onOpenSettings,
}: {
  snapshot: SystemHealthSnapshot | null;
  onSelectTask: (projectId: string, taskId: string) => void;
  onSlept: () => void;
  onOpenSettings: () => void;
}) {
  const activity = useRuntime((s) => s.taskActivity);
  const activeTaskId = useProjects((s) => s.activeTaskId);
  const tasksByProject = useProjects((s) => s.tasksByProject);
  const autoSleepAfter = useSettings((s) => s.autoSleepAfter);
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

  function openAutoSleep() {
    onOpenSettings();
    const ui = useUi.getState();
    ui.setSettingsInitialTab('system-health');
    ui.setShowSettings(true);
  }

  return (
    <div className="grid">
      <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <h4 className="type-heading">System health</h4>
        {snapshot && (
          <Dot
            tone="neutral"
            size="md"
            pulse
            color={memoryColor((snapshot.totalBytes / snapshot.thresholdBytes) * 100)}
            label={headroomLabel(snapshot.totalBytes, snapshot.thresholdBytes)}
          />
        )}
      </header>
      {snapshot ? (
        <>
          <MemoryTimeline snapshot={snapshot} />
          <MachineMemory snapshot={snapshot} />
          <section className="grid gap-1 px-5 pt-5">
            <h5 className="type-label">Heaviest tasks</h5>
            {snapshot.tasks.length === 0 ? (
              <p className="type-label">No task sessions are running.</p>
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
          </section>
        </>
      ) : (
        <p className="type-label px-5">Measuring…</p>
      )}
      <footer className="flex items-center justify-between gap-3 px-5 pt-6 pb-5">
        <p className="type-label">
          Auto-sleep {AUTO_SLEEP_LABELS[autoSleepAfter].toLowerCase()} ·{' '}
          <TextLink onClick={openAutoSleep}>Change</TextLink>
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={!sleepLabel}
          onClick={() => {
            sleepIdleTasks();
            onSlept();
          }}
        >
          {sleepLabel ?? 'Nothing idle to sleep'}
        </Button>
      </footer>
    </div>
  );
}

/**
 * Dash's memory over the last two hours against the warning threshold: the
 * figure (the newest, or the point under the pointer, with its time), and the
 * line, green well under the threshold, amber as it nears, red over it
 * (`memoryColor`, D62). Main keeps the record; each new sample traces in.
 * The figure and its headroom read the line's newest point, not the snapshot,
 * so the figure and the line's end can never disagree.
 */
function MemoryTimeline({ snapshot }: { snapshot: SystemHealthSnapshot }) {
  const history = useSystemHealthStore((s) => s.history);
  const [hovered, setHovered] = useState<TimelinePoint | null>(null);
  const threshold = snapshot.thresholdBytes;
  const points = useMemo(
    () => history.map((p: HealthPoint) => ({ at: p.at, value: p.totalBytes })),
    [history],
  );
  const colorAt = useCallback(
    (bytes: number) => memoryColor((bytes / threshold) * 100),
    [threshold],
  );
  const latest = points[points.length - 1] ?? {
    at: snapshot.sampledAt,
    value: snapshot.totalBytes,
  };
  const to = latest.at;
  const from = Math.min(points[0]?.at ?? to, to - MIN_SPAN_MS);
  const shown = hovered ?? latest;

  return (
    <div className="mx-5 grid gap-3 rounded-md bg-dialog-well px-4 pt-4 pb-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xl font-medium text-ink tabular-nums">
          {formatMemory(shown.value)}
        </span>
        <span className="type-label tabular-nums">
          {hovered ? formatAgo(latest.at - hovered.at) : headroomLabel(latest.value, threshold)}
        </span>
      </div>
      <TimelineChart
        points={points}
        from={from}
        to={to}
        threshold={{ value: threshold, label: `${formatMemory(threshold)} warning` }}
        colorAt={colorAt}
        gapMs={GAP_MS}
        trace
        surface="dialog-well"
        onHover={setHovered}
        aria-label={`Dash and its sessions over the last ${formatDuration(to - from)}: now ${formatMemory(latest.value)} of a ${formatMemory(threshold)} warning`}
      />
      <div className="flex justify-between">
        <span className="type-caption tabular-nums">{formatAgo(to - from)}</span>
        <span className="type-caption">Now</span>
      </div>
    </div>
  );
}

/** Why "Dash's share" is of installed memory (`machineShare`). */
const SHARE_HINT =
  "Dash's part of the memory installed, not of what's available. Available swings as other apps start and stop, so a share of it would jump about and pass 100% under pressure.";

/** The machine, beside Dash's own figure: how much memory is still
 *  available to apps, Dash's share of what is installed (`machineShare`
 *  says why not of what is available), and the OS's pressure where it
 *  has one. */
function MachineMemory({ snapshot }: { snapshot: SystemHealthSnapshot }) {
  const share = machineShare(snapshot);
  const { machine, pressure } = snapshot;
  if (!machine && !pressure) return null;
  return (
    <div className="px-5 pt-5">
      <DetailList numeric>
        {machine && (
          <DetailItem label="Available">
            {formatMemory(machine.availableBytes)} of {formatMemory(machine.totalBytes)}
          </DetailItem>
        )}
        {machine && share !== null && (
          <DetailItem
            label={
              <span className="flex items-center gap-1.5">
                Dash's share
                <InfoTip label="About Dash's share" content={SHARE_HINT} />
              </span>
            }
          >
            {Math.round(share)}% of installed
          </DetailItem>
        )}
        {pressure && (
          <DetailItem label="Memory pressure">
            <span className={cn(pressure !== 'normal' && 'text-warn')}>
              {PRESSURE_LABEL[pressure]}
            </span>
          </DetailItem>
        )}
      </DetailList>
    </div>
  );
}
