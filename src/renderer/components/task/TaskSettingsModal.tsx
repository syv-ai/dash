import React, { useState } from 'react';
import type { PermissionMode, TaskModel, Task } from '../../../shared/types';
import { SettingsModalShell } from '../ui/SettingsModalShell';
import { PermissionModePicker } from './PermissionModePicker';
import { ModelPicker } from './ModelPicker';
import { Expandable } from '../ui/Expandable';
import { SwitchField } from '../ui/SwitchField';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useControlInfo } from '../../hooks/useControlInfo';
import { useRuntime } from '../../stores/runtimeStore';

interface TaskSettingsModalProps {
  task: Task;
  /** True when a Claude PTY is currently attached to the task — drives the
   *  "applies on next start" hint under the permission mode / model pickers. */
  hasActiveSession: boolean;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onPermissionModeChange: (id: string, mode: PermissionMode) => void;
  onModelChange: (id: string, model: TaskModel) => void;
  onScriptsChange: (id: string, setupScript: string, teardownScript: string) => void;
  /** `restart` is true when the task has a session to restart (running or a
   *  parked job): its spawn args are fixed at dispatch, so the change needs a new one. */
  onDashAccessChange: (id: string, enabled: boolean, restart: boolean) => void;
}

export function TaskSettingsModal({
  task,
  hasActiveSession,
  onClose,
  onRename,
  onPermissionModeChange,
  onModelChange,
  onScriptsChange,
  onDashAccessChange,
}: TaskSettingsModalProps) {
  const [name, setName] = useState(task.name);
  const [setupScript, setSetupScript] = useState(task.setupScript ?? '');
  const [teardownScript, setTeardownScript] = useState(task.teardownScript ?? '');
  const controlSupported = useControlInfo()?.supported ?? false;
  // A live session, or a parked job whose spawn args are frozen: either needs a
  // re-dispatch for a Dash access change. 'stopped' with no job has nothing to restart.
  const activityState = useRuntime((s) => s.taskActivity[task.id]?.state);
  const hasSession = (!!activityState && activityState !== 'stopped') || !!task.jobId;
  // The value waiting on the restart confirmation, if any.
  const [pendingDashAccess, setPendingDashAccess] = useState<boolean | null>(null);

  function handleDashAccessToggle(enabled: boolean) {
    if (hasSession) setPendingDashAccess(enabled);
    else onDashAccessChange(task.id, enabled, false);
  }

  function handleSaveScripts() {
    if (
      setupScript !== (task.setupScript ?? '') ||
      teardownScript !== (task.teardownScript ?? '')
    ) {
      onScriptsChange(task.id, setupScript, teardownScript);
    }
  }

  function handleSaveName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== task.name) {
      onRename(task.id, trimmed);
    }
  }

  return (
    <SettingsModalShell title="Task Settings" onClose={onClose}>
      <div>
        <label className="block text-[12px] font-medium text-muted-fade-70 mb-2">Task name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveName();
          }}
          className="w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[13px] placeholder:text-muted-fade-30 focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
        />
        <p className="text-[10px] text-muted-fade-50 mt-1.5 font-mono truncate">{task.branch}</p>
      </div>

      <PermissionModePicker
        value={task.permissionMode}
        onChange={(mode) => onPermissionModeChange(task.id, mode)}
        helperText={hasActiveSession ? 'Applies the next time this session starts' : undefined}
      />

      <ModelPicker
        value={task.model}
        onChange={(model) => onModelChange(task.id, model)}
        helperText={hasActiveSession ? 'Applies the next time this session starts' : undefined}
      />

      {controlSupported && (
        <SwitchField
          label="Dash access"
          hint="Let this task's agent use Dash: its ports and services, and creating tasks of its own."
          helperText={hasSession ? 'Changing it restarts the session' : undefined}
          enabled={task.dashAccess}
          onToggle={handleDashAccessToggle}
        />
      )}

      {task.useWorktree && (
        <Expandable
          label="Worktree scripts"
          hint="setup / teardown"
          defaultOpen={!!(task.setupScript || task.teardownScript)}
        >
          <div className="space-y-3" onBlur={handleSaveScripts}>
            <div>
              <label className="block text-[11px] font-medium text-muted-fade-60 mb-1.5">
                Setup
              </label>
              <textarea
                value={setupScript}
                onChange={(e) => setSetupScript(e.target.value)}
                rows={3}
                placeholder={'pnpm install'}
                className="w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-fade-30 focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 resize-none"
              />
              <p className="text-[10px] text-muted-fade-40 mt-1">
                Already ran when this worktree was created — affects future re-runs only.
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-fade-60 mb-1.5">
                Teardown — runs before this worktree is removed
              </label>
              <textarea
                value={teardownScript}
                onChange={(e) => setTeardownScript(e.target.value)}
                rows={2}
                placeholder={'docker compose down'}
                className="w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-fade-30 focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 resize-none"
              />
            </div>
          </div>
        </Expandable>
      )}

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
    </SettingsModalShell>
  );
}
