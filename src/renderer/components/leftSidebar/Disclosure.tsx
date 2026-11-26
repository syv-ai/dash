import type { ReactNode } from 'react';
import { ListRow } from '../ui/ListRow';
import { BranchChevron } from '../ui/Tree';

/** A quiet chevron row that shows and hides a list beneath it (archived tasks, other sessions). */
export function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <ListRow
        size="sm"
        dimmed
        aria-expanded={open}
        onClick={onToggle}
        leading={
          <span className="-ml-1.5 flex w-6 justify-center">
            <BranchChevron open={open} />
          </span>
        }
      >
        {label}
      </ListRow>
      <div className="collapse-grid" data-open={open}>
        <div>
          <div className="flex flex-col gap-px pl-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
