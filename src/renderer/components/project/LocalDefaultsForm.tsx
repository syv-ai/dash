import React from 'react';
import { ExtraArgsField } from '../task/ExtraArgsField';
import { FormSection } from '../ui/Field';
import { Notice } from '../ui/Notice';
import type { LocalValues } from './configureValues';

/**
 * A project's personal new-task defaults, kept in `.dash/config.local.json`
 * (out of git), as a section for Project settings. Only this file may set
 * them: a shared config.json value is ignored, and `ignored` names it.
 */
export function LocalDefaultsForm({
  value,
  onChange,
  ignored,
}: {
  value: LocalValues;
  onChange: (next: LocalValues) => void;
  /** Local-only keys config.json sets anyway (`taskDefaults.extraArgs`). */
  ignored: string[];
}) {
  return (
    <FormSection
      title="Just for you"
      hint="Kept in .dash/config.local.json, which Dash keeps out of git. Only this file can add flags, so a cloned repository can't put any into your sessions."
    >
      <ExtraArgsField
        value={value.extraArgs}
        onChange={(extraArgs) => onChange({ ...value, extraArgs })}
        hint="Prefilled into each new task's Extra arguments: your own claude flags, after Dash's. Quote like a shell; nothing is expanded. Flags Dash sets itself are refused."
      />
      {ignored.length > 0 && (
        <Notice>
          .dash/config.json sets {ignored.join(', ')}, which Dash ignores: only config.local.json
          can.
        </Notice>
      )}
    </FormSection>
  );
}
