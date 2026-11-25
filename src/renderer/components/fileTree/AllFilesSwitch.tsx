import { useId } from 'react';
import { Switch } from '../ui/Switch';

/** A tree header's "All files" switch: off, the tree lists the changed files
 *  alone; on, every file with them (Files, review mode's Files). */
export function AllFilesSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (allFiles: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-1.5">
      All files
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
