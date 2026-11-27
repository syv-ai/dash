import React from 'react';
import { Plus, X } from 'lucide-react';
import { addDirProblem, normalizeAddDirs, sameAddDirs } from '../../../shared/addDirs';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { PathInput } from '../ui/PathInput';

const HINT =
  "More folders Claude may read and edit in this task's session (claude --add-dir), each a full path. Claude Code must trust each one: if it doesn't yet, the task asks you to accept its trust prompt for that folder.";

/**
 * A task's extra folders (`--add-dir`): one `PathInput` per folder (type or
 * pick), a remove button each, and Add folder. `value` is the draft, blank
 * rows included. With `saved` and `onApply` (Task settings) an Apply button
 * shows while the draft differs, since applying restarts a running session:
 * one deliberate step, not a restart per keystroke or pick.
 */
export function AddDirsField({
  value,
  onChange,
  saved,
  onApply,
  hint = HINT,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  saved?: string[];
  onApply?: (folders: string[]) => void;
  hint?: string;
}) {
  const problems = value.map(addDirProblem).filter((p): p is string => !!p);
  const dirty = !!onApply && !sameAddDirs(value, saved);
  const set = (i: number, folder: string) => onChange(value.map((f, j) => (j === i ? folder : f)));
  return (
    <Field
      as="div"
      label="Folders"
      hint={hint}
      note={problems.length > 0 ? problems.map((p) => <div key={p}>{p}</div>) : undefined}
    >
      {value.map((folder, i) => (
        <div key={i} className="flex min-w-0 items-center gap-1">
          <PathInput
            className="flex-1"
            aria-label={`Folder ${i + 1}`}
            placeholder="/path/to/folder"
            pickerTitle="Choose a folder…"
            value={folder}
            onValueChange={(f) => set(i, f)}
          />
          <IconButton
            size="sm"
            title="Remove folder"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onChange([...value, ''])}>
          <Plus size={14} strokeWidth={1.8} />
          Add folder
        </Button>
        {dirty && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            disabled={problems.length > 0}
            onClick={() => onApply?.(normalizeAddDirs(value))}
          >
            Apply
          </Button>
        )}
      </div>
    </Field>
  );
}
