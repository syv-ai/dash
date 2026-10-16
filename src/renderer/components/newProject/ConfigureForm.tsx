import React from 'react';
import type { PermissionMode } from '../../../shared/types';
import { PERMISSION_MODE_LABELS, type ConfigureValues } from './types';
import { Expandable } from '../ui/Expandable';
import { SwitchField } from '../ui/SwitchField';
import { useControlInfo } from '../../hooks/useControlInfo';

interface ConfigureFormProps {
  value: ConfigureValues;
  onChange: (next: ConfigureValues) => void;
  /** Hide the path-derived name field when the caller renders its own (rare). */
  showName?: boolean;
}

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg bg-transparent border border-input/60 text-foreground text-[13px] placeholder:text-muted-fade-30 focus:outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring/50 transition-all duration-150';
const labelClass = 'block text-[12px] font-medium text-muted-fade-70 mb-2';
const sectionLabel =
  'block text-[10px] font-semibold uppercase tracking-wide text-muted-fade-50 mb-2';

export function ConfigureForm({ value, onChange, showName = true }: ConfigureFormProps) {
  const set = <K extends keyof ConfigureValues>(key: K, v: ConfigureValues[K]) =>
    onChange({ ...value, [key]: v });
  const controlSupported = useControlInfo()?.supported ?? false;

  return (
    <div className="space-y-5">
      {showName && (
        <div>
          <label className={labelClass}>Project name</label>
          <input
            type="text"
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            className={inputClass}
          />
        </div>
      )}

      <div>
        <span className={sectionLabel}>Task defaults — prefilled into every New Task</span>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Base ref</label>
            <input
              type="text"
              value={value.baseRef}
              onChange={(e) => set('baseRef', e.target.value)}
              placeholder="origin/main"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Permission mode</label>
            <select
              value={value.permissionMode}
              onChange={(e) => set('permissionMode', e.target.value as PermissionMode)}
              className={inputClass}
            >
              {(Object.keys(PERMISSION_MODE_LABELS) as PermissionMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {PERMISSION_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-[13px] text-fg-fade-90 cursor-pointer">
          <input
            type="checkbox"
            checked={value.useWorktree}
            onChange={(e) => set('useWorktree', e.target.checked)}
            className="accent-primary"
          />
          Use a git worktree per task
        </label>
        {controlSupported && (
          <div className="mt-3">
            <SwitchField
              label="Dash access for new tasks"
              hint="New tasks start with their agent able to use Dash: its ports and services, and creating tasks of its own."
              enabled={value.dashAccess}
              onToggle={(v) => set('dashAccess', v)}
            />
          </div>
        )}
        <div className="mt-3">
          <Expandable
            label="Default context prompt"
            hint="optional"
            defaultOpen={!!value.contextPrompt.trim()}
          >
            <textarea
              value={value.contextPrompt}
              onChange={(e) => set('contextPrompt', e.target.value)}
              rows={2}
              placeholder="Optional — prepended to each new task's context."
              className={`${inputClass} resize-none`}
            />
          </Expandable>
        </div>
      </div>

      <div>
        <span className={sectionLabel}>Worktree scripts — one command per line</span>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Setup (each new worktree)</label>
            <textarea
              value={value.setup}
              onChange={(e) => set('setup', e.target.value)}
              rows={3}
              placeholder={'pnpm install\ncp ../.env .env'}
              className={`${inputClass} font-mono text-[12px] resize-none`}
            />
          </div>
          <div>
            <label className={labelClass}>Teardown (before removal)</label>
            <textarea
              value={value.teardown}
              onChange={(e) => set('teardown', e.target.value)}
              rows={3}
              placeholder={'docker compose down'}
              className={`${inputClass} font-mono text-[12px] resize-none`}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-fade-60 mt-2 leading-relaxed">
          Env vars exposed to scripts:{' '}
          <code className="font-mono text-fg-fade-80">DASH_WORKTREE_PATH</code>,{' '}
          <code className="font-mono text-fg-fade-80">DASH_PROJECT_PATH</code>,{' '}
          <code className="font-mono text-fg-fade-80">DASH_BRANCH</code>.
        </p>
      </div>
    </div>
  );
}
