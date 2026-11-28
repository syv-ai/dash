import React from 'react';
import { Shield, FilePen, Zap, Flame } from 'lucide-react';
import type { BypassAvailability, PermissionMode } from '../../../shared/types';
import { Field, SettingRow } from '../ui/Field';
import { Select, type SelectOption } from '../ui/Select';
import { bypassUnavailableReason, MODE_LABELS } from './sessionSettingChange';

const OPTIONS: SelectOption<PermissionMode>[] = (
  ['default', 'acceptEdits', 'auto', 'bypassPermissions'] as const
).map((value) => ({ value, label: MODE_LABELS[value] }));

const DESCRIPTIONS: Record<PermissionMode, string> = {
  default: 'Prompts for every tool use',
  acceptEdits: 'Auto-accepts edits, prompts for shell',
  auto: 'A classifier approves safe actions, prompts for risky ones',
  bypassPermissions: 'Skips all permission prompts',
};

function ModeIcon({ mode }: { mode: PermissionMode }) {
  const props = { size: 14, strokeWidth: 1.8, className: 'text-icon' };
  if (mode === 'acceptEdits') return <FilePen {...props} />;
  if (mode === 'auto') return <Zap {...props} />;
  if (mode === 'bypassPermissions') return <Flame {...props} />;
  return <Shield {...props} />;
}

export function PermissionModePicker({
  value,
  onChange,
  /** A short line kept in view (e.g. the mode the session is in now). */
  helperText,
  layout = 'field',
  width = 'md',
  bypass = null,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  helperText?: string;
  /** `field`: label above (a form); `row`: one settings row, select at the end. */
  layout?: 'field' | 'row';
  /** `row` only, the select's width: `md` lines up with the settings dialogs'
   *  fields; `sm` leaves the name room in a narrow column. */
  width?: 'sm' | 'md';
  /** Claude Code's word on bypass for the session's folder: Yolo is off, with
   *  why, when it isn't available. Null while unknown. */
  bypass?: BypassAvailability | null;
}) {
  const offReason = bypassUnavailableReason(bypass);
  // Yolo picked already (a task's setting, a new task's last choice) stays
  // pickable, and the note says why it won't hold.
  const onYolo = value === 'bypassPermissions';
  const note = helperText ?? (onYolo && offReason ? offReason : undefined);
  const options =
    offReason && !onYolo
      ? OPTIONS.map((o) =>
          o.value === 'bypassPermissions' ? { ...o, disabled: true, disabledReason: offReason } : o,
        )
      : OPTIONS;
  const select = (
    <Select<PermissionMode>
      aria-label="Permission mode"
      value={value}
      onValueChange={onChange}
      options={options}
      renderOption={(opt) => (
        <span className="inline-flex items-center gap-2 align-middle">
          <ModeIcon mode={opt.value} />
          <span>{opt.label}</span>
        </span>
      )}
    />
  );
  return layout === 'row' ? (
    <SettingRow
      label="Permission mode"
      hint={DESCRIPTIONS[value]}
      note={note}
      control={<div className={width === 'sm' ? 'w-48' : 'w-56'}>{select}</div>}
    />
  ) : (
    <Field label="Permission mode" as="div" hint={DESCRIPTIONS[value]} note={note}>
      {select}
    </Field>
  );
}
