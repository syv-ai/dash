import React, { useState } from 'react';
import type { PermissionMode, TaskModel, Task } from '../../../shared/types';
import { Dialog, DialogBody, DialogHeader } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { PermissionModePicker } from './PermissionModePicker';
import { ModelPicker } from './ModelPicker';
import { SwitchField } from '../ui/SwitchField';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useControlInfo } from '../../hooks/useControlInfo';
import { useRuntime } from '../../stores/runtimeStore';
import { useTaskBranch } from '../../stores/gitStore';

interface TaskSettingsModalProps {
  task: Task;
  /** True when a Claude PTY is currently attached to the task — drives the
   *  "applies on next start" hint under the permission mode / model pickers. */
  hasActiveSession: boolean;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onPermissionModeChange: (id: string, mode: PermissionMode) => void;
  onModelChange: (id: string, model: TaskModel) => void;
  /** `restart` is true when the task has a session to restart (running or a
   *  parked job): its spawn args are fixed at dispatch, so the change needs a new one. */
  onDashAccessChange: (id: string, enabled: boolean, restart: boolean) => void;
}

const NEXT_START = 'Applies when the session next starts.';

export function TaskSettingsModal({
  task,
  hasActiveSession,
  onClose,
  onRename,
  onPermissionModeChange,
  onModelChange,
  onDashAccessChange,
}: TaskSettingsModalProps) {
  const [name, setName] = useState(task.name);
  const branch = useTaskBranch(task);
  const controlSupported = useControlInfo()?.supported ?? false;
  // A live session, or a parked job: either needs a restart, which rewrites its
  // settings file, for a Dash access change. 'stopped' with no job has nothing to restart.
  const activityState = useRuntime((s) => s.taskActivity[task.id]?.state);
  const hasSession = (!!activityState && activityState !== 'stopped') || !!task.jobId;
  // The value waiting on the restart confirmation, if any.
  const [pendingDashAccess, setPendingDashAccess] = useState<boolean | null>(null);

  function handleDashAccessToggle(enabled: boolean) {
    if (hasSession) setPendingDashAccess(enabled);
    else onDashAccessChange(task.id, enabled, false);
  }

  function handleSaveName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== task.name) {
      onRename(task.id, trimmed);
    }
  }

  return (
    <Dialog size="md" onClose={onClose}>
      <DialogHeader title="Task settings" description={branch} />
      <DialogBody>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveName();
            }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <PermissionModePicker
            value={task.permissionMode}
            onChange={(mode) => onPermissionModeChange(task.id, mode)}
            helperText={hasActiveSession ? NEXT_START : undefined}
          />
          <ModelPicker
            value={task.model}
            onChange={(model) => onModelChange(task.id, model)}
            helperText={hasActiveSession ? NEXT_START : undefined}
          />
        </div>

        {controlSupported && (
          <SwitchField
            label="Dash access"
            hint="The agent can use Dash: its ports and services, tasks of its own, and PR review drafts. Adds a dash skill to the checkout (.claude/skills/dash, kept out of git) that explains dashctl."
            helperText={hasSession ? 'Changing it restarts the session.' : undefined}
            checked={task.dashAccess}
            onCheckedChange={handleDashAccessToggle}
          />
        )}
      </DialogBody>

      {pendingDashAccess !== null && (
        <ConfirmModal
          message="Changing Dash access restarts this task's session."
          confirmLabel="Restart session"
          onConfirm={() => {
            onDashAccessChange(task.id, pendingDashAccess, true);
            setPendingDashAccess(null);
          }}
          onCancel={() => setPendingDashAccess(null)}
        />
      )}
    </Dialog>
  );
}
