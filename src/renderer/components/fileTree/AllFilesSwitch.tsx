import { useId } from 'react';
import { cn } from '../../lib/cn';
import { Switch } from '../ui/Switch';
import { Tooltip } from '../ui/Tooltip';

/** A Files top row's "All files" switch: off, the tree lists the changed
 *  files alone; on, every file with them (Files, review mode's Files). On,
 *  its label steps up from the row's caption to a subheading (semibold,
 *  ink-2), so the row says the tree is showing everything. */
export function AllFilesSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (allFiles: boolean) => void;
}) {
  const id = useId();
  return (
    <Tooltip content="List every file, not just the changed ones">
      <label
        htmlFor={id}
        className={cn('flex cursor-pointer items-center gap-1.5', checked && 'type-subheading')}
      >
        All files
        <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      </label>
    </Tooltip>
  );
}
