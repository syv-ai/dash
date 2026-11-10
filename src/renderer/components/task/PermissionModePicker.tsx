import React from 'react';
import { Shield, FilePen, Zap, Flame } from 'lucide-react';
import { isPermissionMode, type PermissionMode } from '../../../shared/types';
import { Select, type SelectOption } from '../ui/Select';

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
  const props = { size: 13, strokeWidth: 1.8, className: 'text-muted-fade-60' };
  if (mode === 'acceptEdits') return <FilePen {...props} />;
  if (mode === 'auto') return <Zap {...props} />;
  if (mode === 'bypassPermissions') return <Flame {...props} />;
  return <Shield {...props} />;
}

export function PermissionModePicker({
  value,
  onChange,
  /** Optional extra line shown below the description (e.g. "Applies on next start"). */
  helperText,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  helperText?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-fg-fade-70 mb-2">Permission mode</label>
      <Select<PermissionMode>
        value={value}
        onValueChange={onChange}
        options={OPTIONS}
        renderOption={(opt) => (
          <span className="inline-flex items-center gap-2 align-middle">
            <ModeIcon mode={opt.value} />
            <span>{opt.label}</span>
          </span>
        )}
      />
      <p className="mt-1.5 text-[11px] text-muted-fade-50">{DESCRIPTIONS[value]}</p>
      {helperText && <p className="mt-0.5 text-[11px] text-muted-fade-40">{helperText}</p>}
    </div>
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
