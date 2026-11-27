import React from 'react';
import { Sparkles } from 'lucide-react';
import type { TaskModel } from '../../../shared/types';
import { Field, SettingRow } from '../ui/Field';
import { Select, type SelectOption } from '../ui/Select';

const OPTIONS: SelectOption<TaskModel>[] = [
  { value: 'default', label: 'Default' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];

const DESCRIPTIONS: Record<TaskModel, string> = {
  default: 'Uses your Claude Code model setting (no --model)',
  opus: 'Most capable — deep reasoning and long-horizon work',
  sonnet: 'Balanced speed and intelligence',
  haiku: 'Fastest and most economical',
  fable: 'Frontier model for the hardest tasks',
};

const STORAGE_KEY = 'taskModel';

export function ModelPicker({
  value,
  onChange,
  /** A short line kept in view (e.g. "Applies on next start"). */
  helperText,
  layout = 'field',
  width = 'md',
}: {
  value: TaskModel;
  onChange: (model: TaskModel) => void;
  helperText?: string;
  /** `field`: label above (a form); `row`: one settings row, select at the end. */
  layout?: 'field' | 'row';
  /** `row` only, the select's width: `md` lines up with the settings dialogs'
   *  fields; `sm` leaves the name room in a narrow column. */
  width?: 'sm' | 'md';
}) {
  const select = (
    <Select<TaskModel>
      aria-label="Model"
      value={value}
      onValueChange={onChange}
      options={OPTIONS}
      renderOption={(opt) => (
        <span className="inline-flex items-center gap-2 align-middle">
          <Sparkles size={14} strokeWidth={1.8} className="text-icon" />
          <span>{opt.label}</span>
        </span>
      )}
    />
  );
  return layout === 'row' ? (
    <SettingRow
      label="Model"
      hint={DESCRIPTIONS[value]}
      note={helperText}
      control={<div className={width === 'sm' ? 'w-48' : 'w-56'}>{select}</div>}
    />
  ) : (
    <Field label="Model" as="div" hint={DESCRIPTIONS[value]} note={helperText}>
      {select}
    </Field>
  );
}

export function readInitialModel(): TaskModel {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (
    stored === 'default' ||
    stored === 'opus' ||
    stored === 'sonnet' ||
    stored === 'haiku' ||
    stored === 'fable'
  ) {
    return stored;
  }
  return 'default';
}

export function persistModelChoice(model: TaskModel): void {
  localStorage.setItem(STORAGE_KEY, model);
}
