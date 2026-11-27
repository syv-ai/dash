import React, { useId } from 'react';
import { type ConfigureValues } from './configureValues';
import { PermissionModePicker } from '../task/PermissionModePicker';
import { Expandable } from '../ui/Expandable';
import { FormSection, SettingRow } from '../ui/Field';
import { Input } from '../ui/Input';
import { SwitchField } from '../ui/SwitchField';
import { Textarea } from '../ui/Textarea';
import { useControlInfo } from '../../hooks/useControlInfo';

interface ConfigureFormProps {
  value: ConfigureValues;
  onChange: (next: ConfigureValues) => void;
  /** Hide the path-derived name field when the caller renders its own (rare). */
  showName?: boolean;
}

/** A project's `.dash/config.json`: its name and the new-task defaults, as
 *  sections for Project settings' `DialogBody`. */
export function ConfigureForm({ value, onChange, showName = true }: ConfigureFormProps) {
  const set = <K extends keyof ConfigureValues>(key: K, v: ConfigureValues[K]) =>
    onChange({ ...value, [key]: v });
  const controlSupported = useControlInfo()?.supported ?? false;
  const nameId = useId();
  const baseId = useId();

  return (
    <>
      {showName && (
        <FormSection>
          <SettingRow
            label="Name"
            htmlFor={nameId}
            control={
              <Input
                id={nameId}
                className="w-56"
                value={value.name}
                onChange={(e) => set('name', e.target.value)}
              />
            }
          />
        </FormSection>
      )}

      <FormSection title="New tasks" hint="Prefilled into each new task; change them there.">
        <SettingRow
          label="Base branch"
          htmlFor={baseId}
          control={
            <Input
              id={baseId}
              className="w-56"
              value={value.baseRef}
              onChange={(e) => set('baseRef', e.target.value)}
              placeholder="origin/main"
            />
          }
        />
        <PermissionModePicker
          layout="row"
          value={value.permissionMode}
          onChange={(mode) => set('permissionMode', mode)}
        />
        <SwitchField
          label="A worktree per task"
          hint="Each task gets its own git worktree and branch."
          checked={value.useWorktree}
          onCheckedChange={(v) => set('useWorktree', v)}
        />
        {controlSupported && (
          <SwitchField
            label="Dash access"
            hint="The task's agent can use Dash: its ports and services, tasks of its own, and PR review drafts. Adds a dash skill to the checkout (.claude/skills/dash, kept out of git)."
            checked={value.dashAccess}
            onCheckedChange={(v) => set('dashAccess', v)}
          />
        )}
        <div className="py-1">
          <Expandable
            label="Context prompt"
            hint="optional"
            defaultOpen={!!value.contextPrompt.trim()}
          >
            <Textarea
              aria-label="Context prompt"
              value={value.contextPrompt}
              onChange={(e) => set('contextPrompt', e.target.value)}
              rows={3}
              placeholder="Conventions and links put before each new task's context."
              className="resize-none"
            />
          </Expandable>
        </div>
      </FormSection>
    </>
  );
}
