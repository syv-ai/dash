import React from 'react';
import { Shield, FilePen, Zap, Flame } from 'lucide-react';
import {
  isPermissionMode,
  type BypassAvailability,
  type PermissionMode,
} from '../../../shared/types';
import { Field, SettingRow } from '../ui/Field';
import { Select, type SelectOption } from '../ui/Select';
import { bypassUnavailableReason } from './permissionSwitch';

const OPTIONS: SelectOption<PermissionMode>[] = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'auto', label: 'Auto' },
  { value: 'bypassPermissions', label: 'Yolo' },
];

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
  /** A short line kept in view (e.g. "Applies on next start"). */
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
  /** Claude Code's word on bypass for this task: Yolo is off, with why, when
   *  it isn't available. Null while unknown (or for a task not made yet). */
  bypass?: BypassAvailability | null;
}) {
  const offReason = value === 'bypassPermissions' ? null : bypassUnavailableReason(bypass);
  const options = offReason
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
      note={helperText}
      control={<div className={width === 'sm' ? 'w-48' : 'w-56'}>{select}</div>}
    />
  ) : (
    <Field label="Permission mode" as="div" hint={DESCRIPTIONS[value]} note={helperText}>
      {select}
    </Field>
  );
}

/** The last mode picked in Dash, else auto. */
export function readInitialPermissionMode(): PermissionMode {
  const stored = localStorage.getItem('permissionMode');
  if (isPermissionMode(stored)) return stored;
  // One-time migration from the old yoloMode boolean.
  if (localStorage.getItem('yoloMode') === 'true') return 'bypassPermissions';
  return 'auto';
}
