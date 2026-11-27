import React, { useEffect, useId, useState } from 'react';
import type { Task } from '../../../shared/types';
import { Dialog, DialogBody, DialogHeader } from '../ui/Dialog';
import { FormSection, SettingRow } from '../ui/Field';
import { Input } from '../ui/Input';
import { PermissionModePicker } from './PermissionModePicker';
import { ModelPicker } from './ModelPicker';
import { SwitchField } from '../ui/SwitchField';
import { Expandable } from '../ui/Expandable';
import { ExtraArgsField } from './ExtraArgsField';
import { AddDirsField } from './AddDirsField';
import { useControlInfo } from '../../hooks/useControlInfo';
import { useRuntime } from '../../stores/runtimeStore';
import { useTaskBranch } from '../../stores/gitStore';
import { useBypassAvailability } from './changeSessionSetting';
import {
  sessionModeNote,
  sessionModelNote,
  type SessionSettingChange,
} from './sessionSettingChange';

interface TaskSettingsModalProps {
  task: Task;
  /** The model the session's status line reports, if it has. */
  liveModel: string | null;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  /** Confirms and restarts a session itself (changeSessionSetting). */
  onSessionSettingChange: (change: SessionSettingChange) => void;
}

export function TaskSettingsModal({
  task,
  liveModel,
  onClose,
  onRename,
  onSessionSettingChange,
}: TaskSettingsModalProps) {
  const [name, setName] = useState(task.name);
  const nameId = useId();
  const branch = useTaskBranch(task);
  const controlSupported = useControlInfo()?.supported ?? false;
  const sessionMode = useRuntime((s) => s.taskActivity[task.id]?.permissionMode);
  const bypass = useBypassAvailability(task.path);
  const [extraArgs, setExtraArgs] = useState(task.extraArgs ?? '');
  const [addDirs, setAddDirs] = useState<string[]>(task.addDirs);
  // A saved change (or one made elsewhere) replaces the draft.
  useEffect(() => setExtraArgs(task.extraArgs ?? ''), [task.extraArgs]);
  useEffect(() => setAddDirs(task.addDirs), [task.addDirs]);

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
        <FormSection>
          <SettingRow
            label="Name"
            htmlFor={nameId}
            control={
              <Input
                id={nameId}
                className="w-56"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                }}
              />
            }
          />
          <PermissionModePicker
            layout="row"
            value={task.permissionMode}
            onChange={(to) => onSessionSettingChange({ setting: 'permissionMode', to })}
            helperText={sessionModeNote(task.permissionMode, sessionMode)}
            bypass={bypass}
          />
          <ModelPicker
            layout="row"
            value={task.model}
            onChange={(to) => onSessionSettingChange({ setting: 'model', to })}
            helperText={sessionModelNote(task.model, liveModel)}
          />
          {controlSupported && (
            <SwitchField
              label="Dash access"
              hint="The agent can use Dash: its ports and services, tasks of its own, and PR review drafts. Adds a dash skill to the checkout (.claude/skills/dash, kept out of git) that explains dashctl."
              checked={task.dashAccess}
              onCheckedChange={(to) => onSessionSettingChange({ setting: 'dashAccess', to })}
            />
          )}
        </FormSection>
        <FormSection>
          <Expandable label="Advanced" defaultOpen={!!task.extraArgs || task.addDirs.length > 0}>
            <AddDirsField
              value={addDirs}
              onChange={setAddDirs}
              saved={task.addDirs}
              onApply={(to) => onSessionSettingChange({ setting: 'addDirs', to })}
            />
            <ExtraArgsField
              value={extraArgs}
              onChange={setExtraArgs}
              onCommit={(to) =>
                onSessionSettingChange({ setting: 'extraArgs', to: to.trim() || null })
              }
            />
          </Expandable>
        </FormSection>
      </DialogBody>
    </Dialog>
  );
}
