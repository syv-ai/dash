import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { focusRing } from './styles';

interface ExpandableProps {
  label: string;
  /** Open on first render — pass true when the section already has content. */
  defaultOpen?: boolean;
  /** Quiet text after the label (e.g. "optional"). */
  hint?: string;
  children: React.ReactNode;
}

/** A light disclosure for optional fields (a context prompt, worktree
 *  scripts): a chevron and a field label (`type-label`, as `Field`'s) that
 *  fold the children away. Height animates via `.collapse-grid`. */
export function Expandable({ label, defaultOpen = false, hint, children }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('-ml-0.5 flex items-center gap-1 rounded-sm', focusRing)}
      >
        <ChevronRight
          size={14}
          strokeWidth={1.8}
          className={cn('text-icon transition-transform duration-200', open && 'rotate-90')}
        />
        <span className="type-label">{label}</span>
        {hint && <span className="type-caption">{hint}</span>}
      </button>
      <div className="collapse-grid" data-open={open}>
        <div className="pt-1.5">{children}</div>
      </div>
    </div>
  );
}
