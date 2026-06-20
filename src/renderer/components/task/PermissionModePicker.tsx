import React from 'react';
import { Shield, Zap, Flame } from 'lucide-react';
import type { PermissionMode } from '../../../shared/types';
import { Select, type SelectOption } from '../ui/Select';

const OPTIONS: SelectOption<PermissionMode>[] = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Auto' },
  { value: 'bypassPermissions', label: 'Yolo' },
];

const DESCRIPTIONS: Record<PermissionMode, string> = {
  default: 'Prompts for every tool use',
  acceptEdits: 'Auto-accepts edits, prompts for shell',
  bypassPermissions: 'Skips all permission prompts',
};

function ModeIcon({ mode }: { mode: PermissionMode }) {
  const props = { size: 13, strokeWidth: 1.8, className: 'text-muted-foreground/60' };
  if (mode === 'acceptEdits') return <Zap {...props} />;
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
      <label className="block text-[12px] font-medium text-muted-foreground/70 mb-2">
        <span className="flex items-center gap-1.5">
          <Shield size={12} strokeWidth={1.8} />
          Permission mode
        </span>
      </label>
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
      <p className="mt-1.5 text-[11px] text-muted-foreground/50">{DESCRIPTIONS[value]}</p>
      {helperText && <p className="mt-0.5 text-[11px] text-muted-foreground/40">{helperText}</p>}
    </div>
  );
}

export function readInitialPermissionMode(): PermissionMode {
  const stored = localStorage.getItem('permissionMode');
  if (stored === 'default' || stored === 'acceptEdits' || stored === 'bypassPermissions') {
    return stored;
  }
  // One-time migration from the old yoloMode boolean.
  if (localStorage.getItem('yoloMode') === 'true') return 'bypassPermissions';
  return 'default';
}
