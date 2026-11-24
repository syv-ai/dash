import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ListRow } from '../ui/ListRow';

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
            {open ? (
              <ChevronDown size={14} strokeWidth={1.8} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.8} />
            )}
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
