import React from 'react';
import { Sparkles } from 'lucide-react';
import type { TaskModel } from '../../../shared/types';
import { Field } from '../ui/Field';
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
  /** Optional extra line shown below the description (e.g. "Applies on next start"). */
  helperText,
}: {
  value: TaskModel;
  onChange: (model: TaskModel) => void;
  helperText?: string;
}) {
  return (
    <Field
      label="Model"
      as="div"
      hint={
        <>
          {DESCRIPTIONS[value]}
          {helperText && <span className="block">{helperText}</span>}
        </>
      }
    >
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
