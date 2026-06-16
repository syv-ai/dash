import React, { useState } from 'react';
import type { PermissionMode, Task } from '../../shared/types';
import { SettingsModalShell } from './ui/SettingsModalShell';
import { PermissionModePicker } from './PermissionModePicker';
import { Expandable } from './ui/Expandable';

interface TaskSettingsModalProps {
  task: Task;
  /** True when a Claude PTY is currently attached to the task — drives the
   *  "applies on next start" hint under the permission mode picker. */
  hasActiveSession: boolean;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onPermissionModeChange: (id: string, mode: PermissionMode) => void;
  onScriptsChange: (id: string, setupScript: string, teardownScript: string) => void;
}

export function TaskSettingsModal({
  task,
  hasActiveSession,
  onClose,
  onRename,
  onPermissionModeChange,
  onScriptsChange,
}: TaskSettingsModalProps) {
  const [name, setName] = useState(task.name);
  const [setupScript, setSetupScript] = useState(task.setupScript ?? '');
  const [teardownScript, setTeardownScript] = useState(task.teardownScript ?? '');

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
        <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
          Task name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveName();
          }}
          className="w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[13px] placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150"
        />
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 font-mono truncate">
          {task.branch}
        </p>
      </div>

      <PermissionModePicker
        value={task.permissionMode}
        onChange={(mode) => onPermissionModeChange(task.id, mode)}
        helperText={hasActiveSession ? 'Applies the next time this session starts' : undefined}
      />

      {task.useWorktree && (
        <Expandable
          label="Worktree scripts"
          hint="setup / teardown"
          defaultOpen={!!(task.setupScript || task.teardownScript)}
        >
          <div className="space-y-3" onBlur={handleSaveScripts}>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground/60 mb-1.5">
                Setup
              </label>
              <textarea
                value={setupScript}
                onChange={(e) => setSetupScript(e.target.value)}
                rows={3}
                placeholder={'pnpm install'}
                className="w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 resize-none"
              />
              <p className="text-[10px] text-muted-foreground/40 mt-1">
                Already ran when this worktree was created — affects future re-runs only.
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground/60 mb-1.5">
                Teardown — runs before this worktree is removed
              </label>
              <textarea
                value={teardownScript}
                onChange={(e) => setTeardownScript(e.target.value)}
                rows={2}
                placeholder={'docker compose down'}
                className="w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[12px] font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150 resize-none"
              />
            </div>
          </div>
        </Expandable>
      )}
    </SettingsModalShell>
  );
}
