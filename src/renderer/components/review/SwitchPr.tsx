import type { ReactNode } from 'react';
import { PrPicker } from '../diffEditor/PrPicker';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/Popover';

/**
 * "Switch PR…": Compare → Pull requests' picker in a popover anchored on
 * `children`. A pick that loads closes it; one that fails stays open (the
 * host says why).
 */
export function SwitchPr({
  open,
  onOpenChange,
  projectId,
  cwd,
  selected,
  onSwitch,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  cwd: string;
  /** The PR under review, highlighted in the list. */
  selected: number;
  /** Review PR `number` instead; resolves false when it couldn't be loaded. */
  onSwitch: (number: number) => Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent side="bottom" align="start" sideOffset={6}>
        <div className="flex h-95 w-85 flex-col">
          <PrPicker
            projectId={projectId}
            cwd={cwd}
            selected={selected}
            onSelect={async (number) => {
              const ok = await onSwitch(number);
              if (ok) onOpenChange(false);
              return ok;
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
