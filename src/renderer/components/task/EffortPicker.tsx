import React from 'react';
import { Gauge } from 'lucide-react';
import {
  EFFORT_LABELS,
  TASK_EFFORTS,
  defaultEffortFrom,
  type TaskEffort,
} from '../../../shared/effort';
import { SettingRow } from '../ui/Field';
import { Select, type SelectOption } from '../ui/Select';
import { useSettings } from '../../stores/settingsStore';

type Choice = TaskEffort | 'default';

const DESCRIPTIONS: Record<TaskEffort, string> = {
  low: 'Quick exchanges you review each step of (claude --effort low).',
  medium: 'Everyday work (claude --effort medium).',
  high: 'Work where verification matters, like a bug in an existing codebase (claude --effort high).',
  xhigh: 'Deeper reasoning at higher token spend (claude --effort xhigh).',
  max: 'Hard problems to work through alone; can overthink (claude --effort max).',
  ultracode:
    'X-High with ultracode: Claude plans a multi-agent workflow for each substantive task. More tokens, slower (claude --effort ultracode).',
};

/** The default's label: what Settings → Claude gives a task that sets none. */
export function defaultEffortLabel(def: TaskEffort | null): string {
  return def ? `Default (${EFFORT_LABELS[def]})` : 'Default';
}

/** What a level does, as the pickers' ⓘ say it. */
export function effortDescription(effort: TaskEffort): string {
  return DESCRIPTIONS[effort];
}

/** An option's look in an effort picker: the gauge, then its name. */
export function EffortOption({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <Gauge size={14} strokeWidth={1.8} className="text-icon" />
      <span>{label}</span>
    </span>
  );
}

/** What the picker's ⓘ says for a choice. */
export function effortHint(value: TaskEffort | null, def: TaskEffort | null): string {
  if (value)
    return `${DESCRIPTIONS[value]} A model without a level runs at the highest it has below it.`;
  return def
    ? `Settings → Claude's effort, ${EFFORT_LABELS[def]} now. Pick one to give this task its own.`
    : "Settings → Claude's effort, Auto now: Claude Code decides. Pick one to give this task its own.";
}

/**
 * A task's effort, one settings row beside Model: Claude Code's levels plus
 * Ultracode, or Default (Settings → Claude's, named). `null` is Default.
 */
export function EffortPicker({
  value,
  onChange,
  width = 'md',
}: {
  value: TaskEffort | null;
  onChange: (effort: TaskEffort | null) => void;
  /** The select's width, as ModelPicker's. */
  width?: 'sm' | 'md';
}) {
  const def = defaultEffortFrom(useSettings((s) => s.effortLevel));
  const options: SelectOption<Choice>[] = [
    { value: 'default', label: defaultEffortLabel(def) },
    ...TASK_EFFORTS.map((e) => ({ value: e, label: EFFORT_LABELS[e] })),
  ];
  return (
    <SettingRow
      label="Effort"
      hint={effortHint(value, def)}
      control={
        <div className={width === 'sm' ? 'w-48' : 'w-56'}>
          <Select<Choice>
            aria-label="Effort"
            value={value ?? 'default'}
            onValueChange={(v) => onChange(v === 'default' ? null : v)}
            options={options}
            renderOption={(opt) => <EffortOption label={opt.label} />}
          />
        </div>
      }
    />
  );
}
