import React, { useMemo } from 'react';
import { extraArgsMessages, validateExtraArgs } from '../../../shared/extraArgs';
import { Field, NoteLine } from '../ui/Field';
import { Input } from '../ui/Input';

const HINT =
  "Your own claude flags for this task's session, after Dash's (e.g. --chrome). Quote like a shell; nothing is expanded. Flags Dash sets itself, like permissions and model, are refused and point to their picker.";

/**
 * A task's extra `claude` arguments: one line in the code font, checked as
 * it's typed (validateExtraArgs) with what's blocked or risky in the open
 * under it, as the field's notes (blocked in `fail`, risky in `warn`). A labelled field rather than a settings
 * row: a command line wants the column's width. `onCommit` (Task settings) fires on Enter or leaving the field,
 * only for a line that can be passed.
 */
export function ExtraArgsField({
  value,
  onChange,
  onCommit,
  label = 'Extra arguments',
  hint = HINT,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  label?: string;
  hint?: string;
}) {
  const check = useMemo(() => validateExtraArgs(value), [value]);
  const messages = extraArgsMessages(check);
  const commit = () => {
    if (check.ok) onCommit?.(value);
  };
  return (
    <Field
      label={label}
      hint={hint}
      note={
        messages.length > 0
          ? messages.map((m) => (
              <NoteLine key={m.text} tone={m.tone}>
                {m.text}
              </NoteLine>
            ))
          : undefined
      }
    >
      <Input
        mono
        value={value}
        aria-invalid={!check.ok}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        placeholder="--chrome"
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </Field>
  );
}
