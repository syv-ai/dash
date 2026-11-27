import * as React from 'react';
import { FolderOpen } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './IconButton';
import { Input } from './Input';

/**
 * A text field for a folder path with the native folder picker at its end.
 * Typing and pasting work as in any `Input`; the picker's choice replaces the
 * value through `onValueChange`.
 */
export function PathInput({
  value,
  onValueChange,
  pickerTitle = 'Choose a folder…',
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  pickerTitle?: string;
}) {
  async function pick() {
    const resp = await window.electronAPI.showOpenDialog();
    const folder = resp.success ? resp.data?.[0] : undefined;
    if (folder) onValueChange(folder);
  }
  return (
    <div className={cn('relative flex min-w-0 items-center', className)}>
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="pr-9"
        {...props}
      />
      <IconButton
        size="sm"
        title={pickerTitle}
        onClick={() => void pick()}
        className="absolute right-0.5"
      >
        <FolderOpen size={14} strokeWidth={1.8} />
      </IconButton>
    </div>
  );
}
