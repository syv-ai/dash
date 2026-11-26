import React from 'react';
import { type ConfigureValues } from './types';
import { PermissionModePicker } from '../task/PermissionModePicker';
import { Code } from '../ui/Code';
import { Expandable } from '../ui/Expandable';
import { Field, FormSection } from '../ui/Field';
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

/** A project's `.dash/config.json`: its name, the new-task defaults and the
 *  worktree scripts. Sections for a `DialogBody` (the new-project wizard,
 *  project settings). */
export function ConfigureForm({ value, onChange, showName = true }: ConfigureFormProps) {
  const set = <K extends keyof ConfigureValues>(key: K, v: ConfigureValues[K]) =>
    onChange({ ...value, [key]: v });
  const controlSupported = useControlInfo()?.supported ?? false;

  return (
    <>
      {showName && (
        <Field label="Name">
          <Input value={value.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
      )}

      <FormSection title="New tasks" description="Prefilled into each new task; change them there.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base branch">
            <Input
              value={value.baseRef}
              onChange={(e) => set('baseRef', e.target.value)}
              placeholder="origin/main"
            />
          </Field>
          <PermissionModePicker
            value={value.permissionMode}
            onChange={(mode) => set('permissionMode', mode)}
          />
        </div>
        <div className="grid divide-y divide-line">
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
        </div>
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
            placeholder="Put before each new task's context: conventions, links."
            className="resize-none"
          />
        </Expandable>
      </FormSection>

      <FormSection
        title="Worktree scripts"
        description={
          <>
            One command per line. They see <Code>DASH_WORKTREE_PATH</Code>,{' '}
            <Code>DASH_PROJECT_PATH</Code> and <Code>DASH_BRANCH</Code>.
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Setup" hint="In each new worktree.">
            <Textarea
              variant="code"
              value={value.setup}
              onChange={(e) => set('setup', e.target.value)}
              rows={3}
              placeholder={'pnpm install\ncp ../.env .env'}
              className="resize-none"
            />
          </Field>
          <Field label="Teardown" hint="Before a worktree is removed.">
            <Textarea
              variant="code"
              value={value.teardown}
              onChange={(e) => set('teardown', e.target.value)}
              rows={3}
              placeholder="docker compose down"
              className="resize-none"
            />
          </Field>
        </div>
      </FormSection>
    </>
  );
}
