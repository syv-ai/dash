import { useMemo, useState } from 'react';
import { Hourglass } from 'lucide-react';
import type { ClaudeUpdateMode, ClaudeUpdateState } from '../../../shared/types';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Segmented } from '../ui/Segmented';
import { interruptNote, outdatedLine, updateIndicator } from './claudeUpdateCopy';

const MODE_HINT: Record<ClaudeUpdateMode, string> = {
  now: 'Stops any turn in progress, with its subagents.',
  whenDone: 'Waits until every agent and subagent is idle.',
};

/** The names of the outdated tasks that are busy (working, or waiting on the
 *  user): the ones "Interrupt and restart all" would cut off. */
function useBusyOutdatedNames(outdated: ClaudeUpdateState['outdated']): string[] {
  const activity = useRuntime((s) => s.taskActivity);
  const tasksByProject = useProjects((s) => s.tasksByProject);
  return useMemo(() => {
    const names = new Map(
      Object.values(tasksByProject)
        .flat()
        .map((t) => [t.id, t.name]),
    );
    return outdated
      .filter(({ taskId }) => {
        const state = activity[taskId]?.state;
        return state === 'busy' || state === 'waiting';
      })
      .map(({ taskId }) => names.get(taskId) ?? 'A task');
  }, [outdated, activity, tasksByProject]);
}

/**
 * Restart the live sessions that run an older Claude Code onto the installed
 * one: now (interrupting) or once every task is done. Opened from the toast
 * and the sidebar's update icon. While a "when done" restart waits, it says so
 * and offers to stop waiting or to interrupt after all.
 */
export function ClaudeUpdateDialog({
  state,
  onClose,
}: {
  state: ClaudeUpdateState;
  onClose: () => void;
}) {
  const restart = useRuntime((s) => s.restartClaudeSessions);
  const cancel = useRuntime((s) => s.cancelClaudeRestart);
  const waiting = state.restart.phase === 'waiting';
  const restarting = state.restart.phase === 'restarting';
  const [mode, setMode] = useState<ClaudeUpdateMode>(waiting ? 'whenDone' : 'now');
  const indicator = updateIndicator(state);
  const busyNames = useBusyOutdatedNames(state.outdated);
  const count = state.outdated.length;
  const interrupted = mode === 'now' ? interruptNote(busyNames) : null;

  const confirm = () => {
    void restart(mode);
    onClose();
  };

  return (
    <Dialog size="sm" onClose={onClose}>
      <DialogHeader
        title={`Restart on Claude Code ${state.installedVersion}`}
        description="Sessions restart on the new version. Conversations resume."
      />
      <DialogBody compact>
        {restarting ? (
          indicator && (
            <p className="type-body">
              {indicator.title}: {indicator.description}.
            </p>
          )
        ) : (
          <>
            <div className="grid gap-2">
              <Segmented
                aria-label="When to restart"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'now', label: 'Interrupt and restart all' },
                  { value: 'whenDone', label: 'Restart when done' },
                ]}
              />
              {waiting && mode === 'whenDone' && indicator ? (
                <p role="status" className="type-caption flex items-center gap-1.5">
                  <Hourglass size={14} strokeWidth={1.8} className="shrink-0 text-icon" />
                  {indicator.description}.
                </p>
              ) : (
                <p className="type-caption">{MODE_HINT[mode]}</p>
              )}
            </div>
            <p className="type-body">
              {outdatedLine(count)}.{interrupted && ` ${interrupted}`}
            </p>
          </>
        )}
      </DialogBody>
      <DialogFooter
        start={
          waiting && (
            <Button
              variant="ghost"
              onClick={() => {
                void cancel();
                onClose();
              }}
            >
              Stop waiting
            </Button>
          )
        }
      >
        <Button variant="ghost" onClick={onClose}>
          {waiting || restarting ? 'Close' : 'Cancel'}
        </Button>
        {!restarting && !(waiting && mode === 'whenDone') && (
          <Button onClick={confirm} disabled={count === 0}>
            {mode === 'now' ? 'Restart all' : 'Restart when done'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
