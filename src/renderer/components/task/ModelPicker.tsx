import React from 'react';
import { Sparkles } from 'lucide-react';
import type { TaskModel } from '../../../shared/types';
import { Field, SettingRow } from '../ui/Field';
import { Select, type SelectOption } from '../ui/Select';
import { MODEL_LABELS } from './sessionSettingChange';

const OPTIONS: SelectOption<TaskModel>[] = (
  Object.entries(MODEL_LABELS) as [TaskModel, string][]
).map(([value, label]) => ({ value, label }));

const DESCRIPTIONS: Record<TaskModel, string> = {
  default: 'Uses your Claude Code model setting (no --model)',
  opus: 'Most capable — deep reasoning and long-horizon work',
  sonnet: 'Balanced speed and intelligence',
  haiku: 'Fastest and most economical',
  fable: 'Frontier model for the hardest tasks',
};

export function ModelPicker({
  value,
  onChange,
  /** A short line kept in view (e.g. the model the session is on now). */
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
