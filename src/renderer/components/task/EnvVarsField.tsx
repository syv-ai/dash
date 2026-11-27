import React from 'react';
import { ENV_KEY, envProblems } from '../../../shared/taskEnv';
import { Button } from '../ui/Button';
import { EnvVarList } from '../ui/EnvVarList';
import { Field, NoteLine } from '../ui/Field';
import { sameEnv } from './sessionSettingChange';

const HINT =
  "Environment variables for this task's session only, over Settings → Claude's. Dash's own, ANTHROPIC_*, CLAUDE_CODE_* and credentials aren't taken.";

/**
 * Task settings' Environment: the task's own env vars as a draft, with an
 * Apply button while it differs from the saved one (applying restarts a
 * running session: one deliberate step, as for Folders). Each key a person
 * can't set is named under it, and Apply waits until none is left.
 */
export function EnvVarsField({
  value,
  onChange,
  saved,
  onApply,
}: {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  saved: Record<string, string>;
  onApply: (env: Record<string, string>) => void;
}) {
  const problems = envProblems(value, 'person');
  const dirty = !sameEnv(value, saved);
  return (
    <Field
      as="div"
      label="Environment"
      hint={HINT}
      note={
        problems.length > 0
          ? problems.map((p) => (
              <NoteLine key={p.key} tone="fail">
                {p.problem}
              </NoteLine>
            ))
          : undefined
      }
    >
      <EnvVarList value={value} onChange={onChange} canAdd={(name) => ENV_KEY.test(name)} />
      {dirty && (
        <div className="flex items-center">
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            disabled={problems.length > 0}
            onClick={() => onApply(value)}
          >
            Apply
          </Button>
        </div>
      )}
    </Field>
  );
}
