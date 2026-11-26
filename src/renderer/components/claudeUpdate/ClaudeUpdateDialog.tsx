import { useState } from 'react';
import { Hourglass } from 'lucide-react';
import type { ClaudeUpdateMode, ClaudeUpdateState } from '../../../shared/types';
import { useRuntime } from '../../stores/runtimeStore';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { Segmented } from '../ui/Segmented';
import { oldVersions, taskCount, updateIndicator } from './claudeUpdateCopy';

const MODE_HINT: Record<ClaudeUpdateMode, string> = {
  now: 'Every task restarts now. Work in progress stops.',
  whenDone:
    'Waits until no task is working or waiting on you, then restarts them all. Tasks keep working meanwhile.',
};

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
  const count = state.outdated.length;
  const version = state.installedVersion;

  const confirm = () => {
    void restart(mode);
    onClose();
  };

  return (
    <Dialog size="md" onClose={onClose}>
      <DialogHeader
        title={`Restart on Claude Code ${version}`}
        description={
          count > 0
            ? `${taskCount(count)} ${count === 1 ? 'runs' : 'run'} ${oldVersions(state.outdated)}. Restarting moves ${count === 1 ? 'it' : 'them'} to ${version}.`
            : undefined
        }
      />
      <DialogBody compact>
        <ul className="type-body flex list-disc flex-col gap-1 pl-4">
          <li>Each conversation resumes where it left off.</li>
          <li>
            A turn in progress stops, with its subagents and background commands. A question waiting
            for your answer is dropped.
          </li>
          <li>Sleeping tasks start on {version} when you next open them.</li>
        </ul>

        {!restarting && (
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
            <p className="type-caption">{MODE_HINT[mode]}</p>
          </div>
        )}

        {(waiting || restarting) && indicator && (
          <Notice icon={<Hourglass size={14} strokeWidth={1.8} />}>
            {indicator.title}: {indicator.description.toLowerCase()}.
          </Notice>
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
