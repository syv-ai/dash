import React from 'react';
import { Sparkles } from 'lucide-react';
import type { TaskModel } from '../../../shared/types';
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
    <div>
      <label className="block text-[12px] font-medium text-foreground/70 mb-2">Model</label>
      <Select<TaskModel>
        value={value}
        onValueChange={onChange}
        options={OPTIONS}
        renderOption={(opt) => (
          <span className="inline-flex items-center gap-2 align-middle">
            <Sparkles size={13} strokeWidth={1.8} className="text-muted-foreground/60" />
            <span>{opt.label}</span>
          </span>
        )}
      />
      <p className="mt-1.5 text-[11px] text-muted-foreground/50">{DESCRIPTIONS[value]}</p>
      {helperText && <p className="mt-0.5 text-[11px] text-muted-foreground/40">{helperText}</p>}
    </div>
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
